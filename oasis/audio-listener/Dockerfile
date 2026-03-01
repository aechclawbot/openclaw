FROM python:3.11-slim

# Install system dependencies for PyAudio with PulseAudio support via ALSA bridge
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libpulse-dev \
    portaudio19-dev \
    pulseaudio-utils \
    libasound2-plugins \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install Python packages — versions pinned to prevent silent breakage on rebuild.
#
# Compatibility patches in speaker_verify.py (needed for these versions):
#
#   1. torchaudio.list_audio_backends()  — removed in torchaudio 2.10+.
#      SpeechBrain 1.0.3 calls it on import. Patched to return ["soundfile"].
#      Can be removed once SpeechBrain ships a fix (track: speechbrain/speechbrain#2598).
#
#   2. huggingface_hub use_auth_token kwarg — removed in huggingface_hub >= 1.0.
#      SpeechBrain 1.0.3 passes it to hf_hub_download/snapshot_download.
#      Patched to strip the kwarg before calling the original function.
#      Can be removed once SpeechBrain drops the deprecated kwarg.
#
#   3. SpeechBrain custom.py 404 — the ECAPA-TDNN model repo has no custom.py
#      but SpeechBrain tries to fetch it. Pre-created as empty file in /tmp/speechbrain-ecapa/.
#
# Audio is loaded via the wave module (not torchaudio) to sidestep backend issues.
RUN pip install --no-cache-dir \
    pyaudio==0.2.14 \
    webrtcvad==2.0.10 \
    numpy==2.4.2 \
    requests==2.32.5 \
    assemblyai==0.52.4 && \
    pip install --no-cache-dir \
    torch==2.10.0+cpu \
    torchaudio==2.10.0+cpu \
    --index-url https://download.pytorch.org/whl/cpu && \
    pip install --no-cache-dir \
    speechbrain==1.0.3 \
    huggingface_hub==1.5.0

RUN mkdir -p /audio/inbox /audio/done /app /root/.config/pulse \
    /voice-profiles /unknown-speakers

# Configure PulseAudio client: use host socket, disable shared memory (cross-namespace)
RUN echo "default-server = unix:/tmp/pulseaudio.socket" > /root/.config/pulse/client.conf && \
    echo "autospawn = no" >> /root/.config/pulse/client.conf && \
    echo "enable-shm = false" >> /root/.config/pulse/client.conf

# Route ALSA through PulseAudio (PortAudio uses ALSA backend -> ALSA routes to PulseAudio)
RUN echo 'pcm.!default { type pulse }' > /etc/asound.conf && \
    echo 'ctl.!default { type pulse }' >> /etc/asound.conf

WORKDIR /app
COPY app.py /app/app.py
COPY speaker_verify.py /app/speaker_verify.py
COPY assemblyai_transcriber.py /app/assemblyai_transcriber.py

EXPOSE 9001

CMD ["python", "/app/app.py"]
