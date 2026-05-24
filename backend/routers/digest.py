from fastapi import APIRouter, HTTPException
from services import digest_service

router = APIRouter(prefix="/api", tags=["digest"])


@router.get("/digest/latest")
def get_latest():
    data = digest_service.get_latest()
    if data is None:
        raise HTTPException(status_code=404, detail="No digest available yet. Generate one first.")
    return data


@router.post("/digest/generate")
def generate():
    return digest_service.generate()
