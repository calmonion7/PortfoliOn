from fastapi import APIRouter, HTTPException, Depends
from services import digest_service
from auth import get_current_user

router = APIRouter(prefix="/api", tags=["digest"])


@router.get("/digest/latest")
def get_latest(user_id: str = Depends(get_current_user)):
    data = digest_service.get_latest(user_id)
    if data is None:
        raise HTTPException(status_code=404, detail="No digest available yet. Generate one first.")
    return data


@router.post("/digest/generate")
def generate(user_id: str = Depends(get_current_user)):
    return digest_service.generate(user_id)
