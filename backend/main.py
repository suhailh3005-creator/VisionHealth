from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
import json
from rppg import process_signals
from hl7_fhir import create_hl7_observation
import uuid

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    session_id = str(uuid.uuid4())
    patient_id = "anonymous"
    try:
        while True:
            data_str = await websocket.receive_text()
            data = json.loads(data_str)
            r = data.get("r", [])
            g = data.get("g", [])
            b = data.get("b", [])
            fps = data.get("fps", 30)
            
            if len(r) >= 256:
                vitals = process_signals(r[-256:], g[-256:], b[-256:], fps)
                hl7_obs = create_hl7_observation(patient_id, session_id, vitals)
                response = {
                    "vitals": vitals,
                    "hl7": hl7_obs
                }
                await websocket.send_text(json.dumps(response))
            else:
                await websocket.send_text(json.dumps({"status": "buffering", "length": len(r)}))
    except WebSocketDisconnect:
        print("Client disconnected")

@app.get("/health")
def health_check():
    return {"status": "ok"}
