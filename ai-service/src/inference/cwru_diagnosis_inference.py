"""CWRU bearing fault diagnosis inference module."""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import joblib
import numpy as np


class CwruDiagnosisError(ValueError):
    """Raised when diagnosis input or artifacts are incompatible."""


@dataclass(frozen=True)
class DiagnosisResult:
    predicted_class: str
    confidence: float
    class_probabilities: dict[str, float]
    is_uncertain: bool
    model_version: str
    feature_contract: str


def load_diagnosis_artifact(path: str | Path) -> dict[str, Any]:
    artifact = joblib.load(path)
    if not isinstance(artifact, dict):
        raise CwruDiagnosisError("Artifact must be a dictionary.")
    required = ["classifier", "scaler", "feature_order", "class_names"]
    missing = [k for k in required if k not in artifact]
    if missing:
        raise CwruDiagnosisError(f"Missing keys: {missing}")
    return artifact


def extract_window_features(signal: np.ndarray, sampling_rate: int = 12000) -> np.ndarray:
    """Extract 25 features from a single vibration window."""
    sig = np.asarray(signal, dtype=float)
    sig = sig - np.mean(sig)
    sd = float(np.std(sig, ddof=1)) if len(sig) > 1 else 0.0
    rms = float(np.sqrt(np.mean(sig ** 2)))
    mav = float(np.mean(np.abs(sig)))
    p2p = float(np.max(sig) - np.min(sig))
    max_abs = float(np.max(np.abs(sig)))
    kurt = float(np.mean((sig - sig.mean()) ** 4) / (sd ** 4 + 1e-12)) if sd > 0 else 0.0
    skew = float(np.mean((sig - sig.mean()) ** 3) / (sd ** 3 + 1e-12)) if sd > 0 else 0.0
    crest = float(max_abs / (rms + 1e-12))
    shape = float(rms / (mav + 1e-12))
    impulse = float(max_abs / (mav + 1e-12))
    clearance = float(p2p / (mav + 1e-12))
    margin = float(max_abs / (mav + 1e-12))
    n = len(sig)
    zcr = float(np.sum(np.diff(np.signbit(sig)) != 0) / n)

    fft = np.fft.rfft(sig)
    mag = np.abs(fft)
    freqs = np.fft.rfftfreq(n, d=1.0 / sampling_rate)
    if mag.sum() > 0:
        spectral_centroid = float(np.sum(freqs * mag) / np.sum(mag))
        spectral_bandwidth = float(np.sqrt(np.sum(((freqs - spectral_centroid) ** 2) * mag) / np.sum(mag)))
        normalized = mag / mag.sum()
        spectral_entropy = float(-np.sum(normalized * np.log2(normalized + 1e-12)))
        spectral_flatness = float(np.exp(np.mean(np.log(mag + 1e-12))) / (np.mean(mag) + 1e-12))
        spectral_crest = float(np.max(mag) / (np.mean(mag) + 1e-12))
        dom_freq = float(freqs[np.argmax(mag)])
        dom_amp = float(np.max(mag))
    else:
        spectral_centroid = spectral_bandwidth = spectral_entropy = 0.0
        spectral_flatness = spectral_crest = dom_freq = dom_amp = 0.0

    try:
        from scipy.signal import hilbert
        env = np.abs(hilbert(sig))
        env_rms = float(np.sqrt(np.mean(env ** 2)))
        env_sd = float(np.std(env, ddof=1)) if len(env) > 1 else 0.0
        env_kurt = float(np.mean((env - env.mean()) ** 4) / (env_sd ** 4 + 1e-12)) if env_sd > 0 else 0.0
        env_crest = float(np.max(env) / (env_rms + 1e-12))
        env_peak = float(np.max(env))
        env_fft = np.fft.rfft(env)
        env_mag = np.abs(env_fft)
        if env_mag.sum() > 0:
            env_norm = env_mag / env_mag.sum()
            env_spectral_entropy = float(-np.sum(env_norm * np.log2(env_norm + 1e-12)))
        else:
            env_spectral_entropy = 0.0
    except Exception:
        env_rms = env_kurt = env_crest = env_peak = env_spectral_entropy = 0.0

    return np.array([
        rms, sd, mav, p2p, max_abs, kurt, skew,
        crest, shape, impulse, clearance, margin, zcr,
        spectral_centroid, spectral_bandwidth, spectral_entropy,
        spectral_flatness, spectral_crest, dom_freq, dom_amp,
        env_rms, env_kurt, env_crest, env_peak, env_spectral_entropy,
    ], dtype=float)


def diagnose(artifact: dict[str, Any], signal: np.ndarray,
             confidence_threshold: float = 0.70) -> DiagnosisResult:
    """Run fault diagnosis on a vibration signal window."""
    classifier = artifact["classifier"]
    scaler = artifact["scaler"]
    feature_order = artifact["feature_order"]
    class_names = artifact["class_names"]

    feats = extract_window_features(signal)
    X = feats.reshape(1, -1)
    X_scaled = scaler.transform(X)

    proba = classifier.predict_proba(X_scaled)[0]
    pred_idx = int(np.argmax(proba))
    max_prob = float(proba[pred_idx])

    class_probs = {class_names[i]: float(proba[i]) for i in range(len(class_names))}
    is_uncertain = max_prob < confidence_threshold

    return DiagnosisResult(
        predicted_class=class_names[pred_idx],
        confidence=max_prob,
        class_probabilities=class_probs,
        is_uncertain=is_uncertain,
        model_version="0.1.0",
        feature_contract="cwru_diagnosis_features_v1",
    )