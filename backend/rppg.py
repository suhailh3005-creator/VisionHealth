import numpy as np
from scipy import signal, sparse
from scipy.sparse.linalg import spsolve

def smoothness_priors_detrending(data, lambda_val=10):
    length = len(data)
    identity = sparse.eye(length, format='csc')
    diff_matrix = sparse.diags([1, -2, 1], [0, 1, 2], shape=(length - 2, length), format='csc')
    trend = spsolve(identity + lambda_val ** 2 * diff_matrix.T.dot(diff_matrix), data)
    return data - trend

def z_score_normalize(data):
    std = np.std(data)
    if std == 0:
        return np.zeros_like(data)
    return (data - np.mean(data)) / std

def pos_algorithm(r, g, b, fps):
    win_len = len(r)
    r_norm = r / (np.mean(r) + 1e-8)
    g_norm = g / (np.mean(g) + 1e-8)
    b_norm = b / (np.mean(b) + 1e-8)
    x = r_norm - g_norm
    y = r_norm + g_norm - 2 * b_norm
    x_std = np.std(x)
    y_std = np.std(y)
    if y_std == 0:
        y_std = 1e-8
    alpha = x_std / y_std
    h = x - alpha * y
    return h

def bandpass_filter(data, fs, lowcut=0.75, highcut=4.0, order=2):
    nyquist = 0.5 * fs
    low = lowcut / nyquist
    high = highcut / nyquist
    if low >= 1.0 or high >= 1.0:
        return data
    b, a = signal.butter(order, [low, high], btype='band')
    return signal.filtfilt(b, a, data)

def calculate_bpm_welch(bvp, fs):
    nperseg = min(len(bvp), 256)
    f, pxx = signal.welch(bvp, fs, nperseg=nperseg)
    valid_idx = np.where((f >= 0.75) & (f <= 4.0))[0]
    if len(valid_idx) == 0:
        return 0.0
    valid_f = f[valid_idx]
    valid_pxx = pxx[valid_idx]
    peak_idx = np.argmax(valid_pxx)
    return valid_f[peak_idx] * 60.0

def calculate_rr(bvp, fs):
    b, a = signal.butter(2, [0.1 / (0.5 * fs), 0.5 / (0.5 * fs)], btype='band')
    resp_signal = signal.filtfilt(b, a, bvp)
    f, pxx = signal.welch(resp_signal, fs, nperseg=min(len(resp_signal), 256))
    valid_idx = np.where((f >= 0.1) & (f <= 0.5))[0]
    if len(valid_idx) == 0:
        return 0.0
    valid_f = f[valid_idx]
    valid_pxx = pxx[valid_idx]
    peak_idx = np.argmax(valid_pxx)
    return valid_f[peak_idx] * 60.0

def calculate_spo2(r, b):
    r_ac = np.std(smoothness_priors_detrending(r))
    r_dc = np.mean(r)
    b_ac = np.std(smoothness_priors_detrending(b))
    b_dc = np.mean(b)
    if r_dc == 0 or b_dc == 0 or b_ac == 0:
        return 0.0
    rr_ratio = (r_ac / r_dc) / (b_ac / b_dc)
    spo2 = 110 - 25 * rr_ratio
    return np.clip(spo2, 0, 100)

def calculate_bp(bvp):
    peaks, _ = signal.find_peaks(bvp)
    if len(peaks) < 2:
        return 120.0, 80.0
    widths = signal.peak_widths(bvp, peaks, rel_height=0.5)[0]
    mean_width = np.mean(widths)
    mean_peak = np.mean(bvp[peaks])
    sys_bp = 120.0 + (mean_peak * 10) - (mean_width * 0.5)
    dia_bp = 80.0 + (mean_peak * 5) - (mean_width * 0.2)
    return np.clip(sys_bp, 90, 180), np.clip(dia_bp, 60, 110)

def process_signals(r, g, b, fps):
    r_arr = np.array(r)
    g_arr = np.array(g)
    b_arr = np.array(b)
    g_detrended = smoothness_priors_detrending(g_arr)
    g_norm = z_score_normalize(g_detrended)
    val = np.std(g_norm)
    sqi = val if val > 0 else 0 
    if sqi > 1:
        sqi = 1.0 - (sqi - 1.0) * 0.1
    sqi = np.clip(sqi, 0, 1)
    
    bvp = pos_algorithm(r_arr, g_arr, b_arr, fps)
    bvp_filtered = bandpass_filter(bvp, fps)
    
    bpm = calculate_bpm_welch(bvp_filtered, fps)
    rr = calculate_rr(bvp_filtered, fps)
    spo2 = calculate_spo2(r_arr, b_arr)
    sys_bp, dia_bp = calculate_bp(bvp_filtered)
    
    return {
        "bpm": float(bpm),
        "rr": float(rr),
        "spo2": float(spo2),
        "bp_sys": float(sys_bp),
        "bp_dia": float(dia_bp),
        "sqi": float(sqi),
        "bvp": bvp_filtered.tolist()
    }
