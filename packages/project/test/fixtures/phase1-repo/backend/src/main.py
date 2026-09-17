@app.get("/health/ready")
async def health_ready():
    readiness = database_readiness()
    return readiness
