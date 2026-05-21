import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.ticker as mticker
import pandas as pd
from pathlib import Path

from services.indicators import calc_rsi

def generate_revenue_chart(quarters: list[dict], ticker: str, output_dir: Path) -> str:
    if not quarters:
        return ""
    periods = [q["period"] for q in quarters]
    revenues = [(q["revenue"] or 0) / 1e9 for q in quarters]
    op_incomes = [(q["operating_income"] or 0) / 1e9 for q in quarters]

    x = list(range(len(periods)))
    fig, ax = plt.subplots(figsize=(8, 4))
    w = 0.35
    ax.bar([i - w / 2 for i in x], revenues, w, label="Revenue ($B)", color="#4472C4")
    ax.bar([i + w / 2 for i in x], op_incomes, w, label="Op. Income ($B)", color="#ED7D31")
    ax.set_xticks(x)
    ax.set_xticklabels(periods, rotation=30, ha="right")
    ax.yaxis.set_major_formatter(mticker.FormatStrFormatter("$%.1fB"))
    ax.legend()
    ax.set_title(f"{ticker} — Quarterly Financials")
    fig.tight_layout()

    output_dir.mkdir(parents=True, exist_ok=True)
    path = output_dir / "revenue_chart.png"
    fig.savefig(path, dpi=100)
    plt.close(fig)
    return str(path)

def generate_rsi_chart(daily_close: pd.Series, ticker: str, output_dir: Path) -> str:
    if daily_close.empty:
        return ""
    rsi = calc_rsi(daily_close).tail(90)

    fig, ax = plt.subplots(figsize=(10, 3))
    ax.plot(rsi.index, rsi.values, color="#4472C4", linewidth=1.5, label="RSI(14)")
    ax.axhline(70, color="red",   linestyle="--", linewidth=0.8, label="Overbought 70")
    ax.axhline(30, color="green", linestyle="--", linewidth=0.8, label="Oversold 30")
    ax.axhline(50, color="gray",  linestyle=":",  linewidth=0.8)
    ax.set_ylim(0, 100)
    ax.set_title(f"{ticker} — RSI(14) Daily (90d)")
    ax.legend(loc="upper left", fontsize=8)
    fig.tight_layout()

    output_dir.mkdir(parents=True, exist_ok=True)
    path = output_dir / "rsi_chart.png"
    fig.savefig(path, dpi=100)
    plt.close(fig)
    return str(path)
