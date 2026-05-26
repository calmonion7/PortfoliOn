from concurrent.futures import ThreadPoolExecutor
from typing import Callable


def parallel_map(func: Callable, items: list, max_workers: int = 10) -> list:
    if not items:
        return []
    with ThreadPoolExecutor(max_workers=min(len(items), max_workers)) as executor:
        return list(executor.map(func, items))
