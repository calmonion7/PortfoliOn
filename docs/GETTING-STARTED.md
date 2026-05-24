<!-- generated-by: gsd-doc-writer -->
# Getting Started

## Prerequisites

| Tool | Version |
|------|---------|
| Python | >= 3.9 |
| Node.js | >= 18.0 |
| npm | >= 9.0 |

Verify your versions:

```bash
python3 --version
node --version
npm --version
```

## Installation

**1. Clone the repository**

```bash
git clone <repository-url>
cd PortfoliOn
```

**2. Set up the Python virtual environment**

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate          # macOS/Linux
# .venv\Scripts\activate           # Windows
pip install -r requirements.txt
cd ..
```

**3. Install frontend dependencies**

```bash
cd frontend
npm install
cd ..
```

**4. Configure environment variables**

Create a `.env` file in the project root:

```bash
# Required for AI report generation
ANTHROPIC_API_KEY=your_anthropic_api_key

# Required for economic indicators (FRED data)
FRED_API_KEY=your_fred_api_key

# Optional: Korea trade export data
KITA_API_KEY=your_kita_api_key
```

- `ANTHROPIC_API_KEY` — obtain from [console.anthropic.com](https://console.anthropic.com)
- `FRED_API_KEY` — obtain from [fred.stlouisfed.org/docs/api/api_key.html](https://fred.stlouisfed.org/docs/api/api_key.html)
- `KITA_API_KEY` — required only for Korea export chart data; the app runs without it

## Starting the Servers

**macOS/Linux**

```bash
./start.sh
```

**Windows**

```bat
start.bat
```

Both scripts kill any existing processes on ports 8000 and 5173, start backend and frontend in the background, wait until both are healthy, then open `http://localhost:5173` in your browser.

Logs are written to:
- macOS/Linux: `/tmp/portfolion-backend.log`, `/tmp/portfolion-frontend.log`
- Windows: `%TEMP%\portfolion-backend.log`, `%TEMP%\portfolion-frontend.log`

**Stopping the servers**

```bash
./stop.sh      # macOS/Linux
stop.bat       # Windows
```

## First Run Verification

Once both servers are up, confirm they are healthy:

```bash
curl http://localhost:8000/health    # should return {"status":"ok"} or similar
curl -I http://localhost:5173        # should return HTTP 200
```

Open `http://localhost:5173` in your browser. The portfolio page should load. If market indicator data is missing, confirm `FRED_API_KEY` is set correctly.

## Common Setup Issues

**`ModuleNotFoundError` on backend start**
The virtual environment is not activated or dependencies are not installed. Re-run:
```bash
cd backend && source .venv/bin/activate && pip install -r requirements.txt
```

**Port already in use (8000 or 5173)**
`start.sh` / `start.bat` kill existing processes on those ports automatically. If the error persists, run `stop.sh` first.

**`FRED_API_KEY` not set — economic indicators return empty**
Economic indicator endpoints (`/api/market-indicators`) will return empty data or errors without a valid FRED key. The rest of the app functions normally.

**Windows: servers start but browser shows blank page**
The `start.bat` script runs servers in hidden PowerShell windows. Check `%TEMP%\portfolion-backend.log` for startup errors.

## Next Steps

- See [DEVELOPMENT.md](DEVELOPMENT.md) for local dev workflow, build scripts, and code style.
- See [ARCHITECTURE.md](ARCHITECTURE.md) for system design and component overview.
- See [CONFIGURATION.md](CONFIGURATION.md) for the full environment variable reference.
