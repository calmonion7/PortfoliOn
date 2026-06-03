from fastapi import APIRouter, Depends
from services import digest_service
from auth import get_current_user

router = APIRouter(prefix="/api", tags=["digest"])


@router.get("/digest/latest")
def get_latest(user_id: str = Depends(get_current_user)):
    return digest_service.get_latest(user_id)


@router.post("/digest/generate")
def generate(user_id: str = Depends(get_current_user)):
    return digest_service.generate(user_id)
