$env:PYTHONUTF8=1
$env:PYTHONUNBUFFERED=1
$env:PATH = "$pwd\venv\Lib\site-packages\nvidia\cublas\bin;$pwd\venv\Lib\site-packages\nvidia\cudnn\bin;$env:PATH"
.\venv\Scripts\python.exe -m uvicorn main:app --host 0.0.0.0 --port 8000
