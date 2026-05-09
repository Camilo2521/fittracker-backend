import hmac
import hashlib
import time
from fastapi import Header, HTTPException
from app.config import get_settings


def verify_internal_token(x_internal_token: str = Header(...)) -> None:
    """
    Valida el token HMAC generado por Node.js.
    Formato: "{timestamp}.{sha256_hex}"
    Ventana de validez: 30 segundos.
    """
    settings = get_settings()
    try:
        ts_str, sig = x_internal_token.split(".", 1)
        ts = float(ts_str)

        if abs(time.time() - ts) > 30:
            raise ValueError("Token expirado")

        expected = hmac.new(
            settings.internal_api_secret.encode(),
            ts_str.encode(),
            hashlib.sha256,
        ).hexdigest()

        if not hmac.compare_digest(sig, expected):
            raise ValueError("Firma inválida")

    except (ValueError, AttributeError) as exc:
        raise HTTPException(status_code=401, detail=f"Token interno inválido: {exc}")
