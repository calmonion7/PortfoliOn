from fastapi import HTTPException


def not_found(ticker: str, context: str = "") -> HTTPException:
    detail = f"{ticker} not found" + (f" in {context}" if context else "")
    return HTTPException(status_code=404, detail=detail)


def already_exists(ticker: str, context: str = "") -> HTTPException:
    detail = f"{ticker} already exists" + (f" in {context}" if context else "")
    return HTTPException(status_code=400, detail=detail)
