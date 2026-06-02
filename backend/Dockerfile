FROM nvidia/cuda:12.2.2-cudnn8-runtime-ubuntu22.04

# Avoid tzdata interactive prompts
ENV DEBIAN_FRONTEND=noninteractive

# Install Python 3.13 and dependencies
RUN apt-get update && apt-get install -y software-properties-common curl git \
    && add-apt-repository ppa:deadsnakes/ppa \
    && apt-get update \
    && apt-get install -y python3.13 python3.13-venv python3.13-dev \
    && curl -sS https://bootstrap.pypa.io/get-pip.py | python3.13 \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Set python3 to point to python3.13
RUN update-alternatives --install /usr/bin/python3 python3 /usr/bin/python3.13 1

# HF Spaces require running as a non-root user (uid 1000)
RUN useradd -m -u 1000 user
USER user
ENV HOME=/home/user
ENV PATH=$HOME/.local/bin:$PATH

WORKDIR $HOME/app

# Install Python dependencies
COPY --chown=user:user requirements.txt .
RUN python3 -m pip install --user --no-cache-dir -r requirements.txt

# Copy source code
COPY --chown=user:user . .

# Pre-fetch data and model during build so cold starts are instant
RUN python3 -c "import asyncio; from quran.loader import load_quran_data; from asr.whisper_engine import load_model; asyncio.run(load_quran_data()); asyncio.run(load_model())"

# Expose the HF Spaces port
EXPOSE 7860

# Run the backend
CMD ["python3", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "7860"]
