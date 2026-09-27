import React, { useState, useEffect, useRef, useCallback } from 'react';
import { FaceMesh } from '@mediapipe/face_mesh';
import { Camera } from '@mediapipe/camera_utils';
import Chart from 'chart.js/auto';
function App() {
    const videoRef = useRef(null);
    const canvasRef = useRef(null);
    const chartRef = useRef(null);
    const chartInstance = useRef(null);
    const wsRef = useRef(null);
    const rBuf = useRef([]);
    const gBuf = useRef([]);
    const bBuf = useRef([]);
    const [vitals, setVitals] = useState({ bpm: 0, rr: 0, spo2: 0, bp_sys: 0, bp_dia: 0, sqi: 1 });
    const [timer, setTimer] = useState(30);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [showModal, setShowModal] = useState(false);
    const [csvData, setCsvData] = useState([]);
    const [lowSqi, setLowSqi] = useState(false);
    const [finalStats, setFinalStats] = useState(null);
    const lastTimeRef = useRef(performance.now());
    const fpsRef = useRef(30);

    const initChart = () => {
        if (chartInstance.current) chartInstance.current.destroy();
        const ctx = chartRef.current.getContext('2d');
        chartInstance.current = new Chart(ctx, {
            type: 'line',
            data: {
                labels: Array(256).fill(''),
                datasets: [{
                    label: 'BVP Wave',
                    data: Array(256).fill(0),
                    borderColor: '#32FF7E',
                    borderWidth: 2,
                    pointRadius: 0,
                    tension: 0.4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: false,
                scales: {
                    x: { display: false },
                    y: { display: false, min: -3, max: 3 }
                },
                plugins: { legend: { display: false } }
            }
        });
    };

    const drawDoodle = (show) => {
        const c = document.getElementById('alert-canvas');
        const ctx = c.getContext('2d');
        c.width = window.innerWidth;
        c.height = window.innerHeight;
        ctx.clearRect(0,0,c.width,c.height);
        if (show) {
            ctx.fillStyle = 'rgba(255, 0, 50, 0.2)';
            ctx.fillRect(0,0,c.width,c.height);
            ctx.font = 'bold 48px sans-serif';
            ctx.fillStyle = '#FF0032';
            ctx.textAlign = 'center';
            ctx.shadowColor = '#FF0032';
            ctx.shadowBlur = 20;
            ctx.fillText('Low Signal Quality - Check Lighting', c.width/2, 100);
            
            ctx.beginPath();
            ctx.strokeStyle = '#FF0032';
            ctx.lineWidth = 5;
            for(let i=0; i<10; i++) {
                ctx.moveTo(Math.random()*c.width, Math.random()*c.height);
                ctx.lineTo(Math.random()*c.width, Math.random()*c.height);
            }
            ctx.stroke();
        }
    };

    const processFrame = useCallback((results) => {
        const canvasCtx = canvasRef.current.getContext('2d');
        canvasCtx.save();
        canvasCtx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
        canvasCtx.translate(canvasRef.current.width, 0);
        canvasCtx.scale(-1, 1);
        canvasCtx.drawImage(results.image, 0, 0, canvasRef.current.width, canvasRef.current.height);
        
        let avgR = 0, avgG = 0, avgB = 0;
        let valid = false;

        if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
            const landmarks = results.multiFaceLandmarks[0];
            drawConnectors(canvasCtx, landmarks, FACEMESH_TESSELATION, {color: '#32FF7E', lineWidth: 1});
            
            const rois = [
                [10, 109, 67, 103, 104, 105, 66, 107, 336, 296, 334, 333, 332, 297, 338],
                [116, 117, 101, 205, 36, 203, 98, 97, 2, 326, 327],
                [345, 346, 330, 425, 266, 423, 327, 326, 2, 97, 98]
            ];
            
            let totalR=0, totalG=0, totalB=0, pixels=0;
            const imgData = canvasCtx.getImageData(0, 0, canvasRef.current.width, canvasRef.current.height);
            const data = imgData.data;
            const w = canvasRef.current.width;
            
            rois.forEach(roi => {
                let minX = w, maxX = 0, minY = canvasRef.current.height, maxY = 0;
                roi.forEach(idx => {
                    const lm = landmarks[idx];
                    if(!lm) return;
                    const x = Math.floor(lm.x * w);
                    const y = Math.floor(lm.y * canvasRef.current.height);
                    if(x < minX) minX = x;
                    if(x > maxX) maxX = x;
                    if(y < minY) minY = y;
                    if(y > maxY) maxY = y;
                });
                
                minX = Math.max(0, minX);
                maxX = Math.min(w-1, maxX);
                minY = Math.max(0, minY);
                maxY = Math.min(canvasRef.current.height-1, maxY);
                
                for(let y=minY; y<=maxY; y+=2) {
                    for(let x=minX; x<=maxX; x+=2) {
                        const i = (y * w + x) * 4;
                        totalR += data[i];
                        totalG += data[i+1];
                        totalB += data[i+2];
                        pixels++;
                    }
                }
            });
            
            if(pixels > 0) {
                avgR = totalR / pixels;
                avgG = totalG / pixels;
                avgB = totalB / pixels;
                valid = true;
            }
        }
        canvasCtx.restore();

        const now = performance.now();
        const dt = now - lastTimeRef.current;
        if(dt > 0) fpsRef.current = 0.9 * fpsRef.current + 0.1 * (1000 / dt);
        lastTimeRef.current = now;

        if (valid) {
            rBuf.current.push(avgR);
            gBuf.current.push(avgG);
            bBuf.current.push(avgB);
            
            if (rBuf.current.length > 256) {
                rBuf.current.shift();
                gBuf.current.shift();
                bBuf.current.shift();
            }

            if (rBuf.current.length === 256 && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                if (Math.random() < 0.1) {
                    wsRef.current.send(JSON.stringify({
                        r: rBuf.current,
                        g: gBuf.current,
                        b: bBuf.current,
                        fps: fpsRef.current
                    }));
                }
            }
        }
    }, []);

    useEffect(() => {
        initChart();
        wsRef.current = new WebSocket('ws://localhost:8000/ws');
        
        wsRef.current.onmessage = (e) => {
            const data = JSON.parse(e.data);
            if(data.vitals) {
                setVitals(data.vitals);
                if (chartInstance.current && data.vitals.bvp) {
                    chartInstance.current.data.datasets[0].data = data.vitals.bvp;
                    chartInstance.current.update();
                }
                const sqiAlert = data.vitals.sqi < 0.5;
                setLowSqi(sqiAlert);
                drawDoodle(sqiAlert);
            }
        };

        const faceMesh = new FaceMesh({locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`});
        faceMesh.setOptions({
            maxNumFaces: 1,
            refineLandmarks: true,
            minDetectionConfidence: 0.5,
            minTrackingConfidence: 0.5
        });
        
        faceMesh.onResults(processFrame);
        
        const camera = new Camera(videoRef.current, {
            onFrame: async () => {
                await faceMesh.send({image: videoRef.current});
            },
            width: 640,
            height: 480
        });
        camera.start();

        return () => {
            camera.stop();
            if(wsRef.current) wsRef.current.close();
        };
    }, []);

    useEffect(() => {
        let interval;
        if (isAnalyzing && timer > 0) {
            interval = setInterval(() => {
                setTimer(p => p - 1);
                if (rBuf.current.length > 0) {
                    const nr = rBuf.current[rBuf.current.length-1];
                    const ng = gBuf.current[gBuf.current.length-1];
                    const nb = bBuf.current[bBuf.current.length-1];
                    setCsvData(prev => [...prev, {
                        timestamp: new Date().toISOString(),
                        red: nr, green: ng, blue: nb,
                        bpm: vitals.bpm, rr: vitals.rr, spo2: vitals.spo2,
                        bp_sys: vitals.bp_sys, bp_dia: vitals.bp_dia, sqi: vitals.sqi
                    }]);
                }
            }, 1000);
        } else if (isAnalyzing && timer === 0) {
            setIsAnalyzing(false);
            calculateFinalStats();
            setShowModal(true);
        }
        return () => clearInterval(interval);
    }, [isAnalyzing, timer, vitals]);

    const calculateFinalStats = () => {
        if(csvData.length === 0) return;
        const sum = (key) => csvData.reduce((a,b) => a + b[key], 0);
        const mean = (key) => sum(key) / csvData.length;
        const stdDev = (key, m) => Math.sqrt(csvData.reduce((a,b) => a + Math.pow(b[key] - m, 2), 0) / csvData.length);
        
        const stats = {};
        ['bpm', 'rr', 'spo2', 'bp_sys', 'bp_dia'].forEach(k => {
            const m = mean(k);
            stats[k] = { mean: m.toFixed(2), std: stdDev(k, m).toFixed(2) };
        });
        setFinalStats(stats);
    };

    const downloadCsv = () => {
        const header = "Timestamp,Red_Avg,Green_Avg,Blue_Avg,BPM,RR,SpO2,BP_Sys,BP_Dia,SQI\n";
        const rows = csvData.map(r => `${r.timestamp},${r.red},${r.green},${r.blue},${r.bpm},${r.rr},${r.spo2},${r.bp_sys},${r.bp_dia},${r.sqi}`).join("\n");
        const blob = new Blob([header + rows], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `VisionHealth_Report_${new Date().getTime()}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    };

    return (
        <div className="min-h-screen p-8 flex flex-col items-center">
            <h1 className="text-5xl font-black mb-10 tracking-widest neon-text">VISIONHEALTH rPPG</h1>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 w-full max-w-6xl">
                <div className="clay-card flex flex-col items-center justify-center relative overflow-hidden">
                    <video ref={videoRef} className="hidden" />
                    <canvas ref={canvasRef} width="640" height="480" className="w-full h-auto rounded-lg"></canvas>
                    <div className="absolute top-4 right-4 clay-card py-2 px-4 text-sm font-bold">
                        SQI: {vitals.sqi.toFixed(2)}
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                    <div className="clay-card flex flex-col items-center justify-center">
                        <span className="text-gray-400 uppercase text-xs font-bold tracking-widest">Heart Rate</span>
                        <span className="text-5xl font-black text-[#32FF7E] mt-2">{vitals.bpm.toFixed(1)} <span className="text-lg">BPM</span></span>
                    </div>
                    <div className="clay-card flex flex-col items-center justify-center">
                        <span className="text-gray-400 uppercase text-xs font-bold tracking-widest">Respiration</span>
                        <span className="text-5xl font-black text-[#32FF7E] mt-2">{vitals.rr.toFixed(1)} <span className="text-lg">RPM</span></span>
                    </div>
                    <div className="clay-card flex flex-col items-center justify-center">
                        <span className="text-gray-400 uppercase text-xs font-bold tracking-widest">Oxygen</span>
                        <span className="text-5xl font-black text-[#32FF7E] mt-2">{vitals.spo2.toFixed(1)} <span className="text-lg">%</span></span>
                    </div>
                    <div className="clay-card flex flex-col items-center justify-center">
                        <span className="text-gray-400 uppercase text-xs font-bold tracking-widest">Blood Pressure</span>
                        <span className="text-4xl font-black text-[#32FF7E] mt-2">{vitals.bp_sys.toFixed(0)}/{vitals.bp_dia.toFixed(0)}</span>
                    </div>
                </div>
            </div>

            <div className="w-full max-w-6xl mt-8 clay-card" style={{height: '200px'}}>
                <canvas ref={chartRef}></canvas>
            </div>

            <div className="mt-12 flex gap-4 items-center">
                <input 
                    type="number" 
                    value={timer} 
                    onChange={e => setTimer(parseInt(e.target.value)||0)}
                    disabled={isAnalyzing}
                    className="clay-card text-center text-xl w-24 outline-none border border-gray-800 bg-transparent text-white"
                    min="1"
                />
                <button 
                    onClick={() => {
                        setCsvData([]);
                        setIsAnalyzing(true);
                    }}
                    disabled={isAnalyzing}
                    className="clay-card text-[#32FF7E] font-bold text-xl px-8 hover:bg-[#32FF7E] hover:text-[#0B0E14] transition-all cursor-pointer disabled:opacity-50"
                >
                    {isAnalyzing ? `ANALYZING... ${timer}s` : 'START ANALYSIS'}
                </button>
            </div>

            {showModal && finalStats && (
                <div className="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center z-50">
                    <div className="clay-card max-w-lg w-full p-8 border-2 border-[#32FF7E] relative bg-[#0B0E14]">
                        <h2 className="text-3xl font-black mb-6 text-[#32FF7E] text-center uppercase tracking-widest">Final Diagnosis</h2>
                        <div className="space-y-4 mb-8 text-lg">
                            <div className="flex justify-between border-b border-gray-800 pb-2"><span>Heart Rate</span> <span>{finalStats.bpm.mean} ± {finalStats.bpm.std}</span></div>
                            <div className="flex justify-between border-b border-gray-800 pb-2"><span>Respiration</span> <span>{finalStats.rr.mean} ± {finalStats.rr.std}</span></div>
                            <div className="flex justify-between border-b border-gray-800 pb-2"><span>SpO2</span> <span>{finalStats.spo2.mean} ± {finalStats.spo2.std}</span></div>
                            <div className="flex justify-between border-b border-gray-800 pb-2"><span>BP Systolic</span> <span>{finalStats.bp_sys.mean} ± {finalStats.bp_sys.std}</span></div>
                            <div className="flex justify-between border-b border-gray-800 pb-2"><span>BP Diastolic</span> <span>{finalStats.bp_dia.mean} ± {finalStats.bp_dia.std}</span></div>
                        </div>
                        <div className="flex gap-4">
                            <button onClick={downloadCsv} className="flex-1 clay-card bg-[#32FF7E] text-[#0B0E14] font-bold hover:bg-white transition-all text-center">
                                DOWNLOAD REPORT
                            </button>
                            <button onClick={() => setShowModal(false)} className="clay-card font-bold hover:text-[#32FF7E] transition-all border border-gray-700">
                                CLOSE
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}


