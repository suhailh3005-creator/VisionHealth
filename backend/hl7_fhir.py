import datetime
import uuid

def create_hl7_observation(patient_id, session_id, vitals):
    now = datetime.datetime.utcnow().isoformat() + "Z"
    components = []
    
    metrics = {
        "HeartRate": {"code": "8867-4", "display": "Heart rate", "unit": "beats/minute", "value": vitals.get("bpm", 0)},
        "RespiratoryRate": {"code": "9279-1", "display": "Respiratory rate", "unit": "breaths/minute", "value": vitals.get("rr", 0)},
        "SpO2": {"code": "59408-5", "display": "Oxygen saturation", "unit": "%", "value": vitals.get("spo2", 0)},
        "SystolicBP": {"code": "8480-6", "display": "Systolic blood pressure", "unit": "mmHg", "value": vitals.get("bp_sys", 0)},
        "DiastolicBP": {"code": "8462-4", "display": "Diastolic blood pressure", "unit": "mmHg", "value": vitals.get("bp_dia", 0)}
    }
    
    for key, data in metrics.items():
        components.append({
            "code": {
                "coding": [
                    {
                        "system": "http://loinc.org",
                        "code": data["code"],
                        "display": data["display"]
                    }
                ]
            },
            "valueQuantity": {
                "value": data["value"],
                "unit": data["unit"],
                "system": "http://unitsofmeasure.org",
                "code": data["unit"]
            }
        })
        
    observation = {
        "resourceType": "Observation",
        "id": str(uuid.uuid4()),
        "status": "final",
        "category": [
            {
                "coding": [
                    {
                        "system": "http://terminology.hl7.org/CodeSystem/observation-category",
                        "code": "vital-signs",
                        "display": "Vital Signs"
                    }
                ]
            }
        ],
        "subject": {
            "reference": f"Patient/{patient_id}"
        },
        "encounter": {
            "reference": f"Encounter/{session_id}"
        },
        "effectiveDateTime": now,
        "component": components
    }
    
    return observation
