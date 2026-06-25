#!/usr/bin/env python3
"""
Markdown 诗文集阅读器 📖
用法: python read_md.py <文件路径...>
      python read_md.py Test.md 诗韵小集.md   # 读取指定文件
      python read_md.py                        # 默认读取当前目录下所有 .md
"""

import sys, os, re
from pathlib import Path


def read_file(path: Path):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return f.read().splitlines()
    except Exception as e:
        print(f"  ❌ 读取失败: {e}")
        return None


def parse_md(lines: list[str]) -> dict:
    info = {
        "title": "",
        "epigraph": "",
        "sections": [],
        "poems": [],
    }

    current_section = {"heading": "", "lines": []}
    in_quote = False
    quote_lines = []

    for line in lines:
        # 引用块
        if line.startswith(">"):
            in_quote = True
            quote_lines.append(line.lstrip("> ").strip())
            continue
        else:
            if in_quote:
                in_quote = False
                info["epigraph"] = "\n".join(quote_lines)
                quote_lines = []

        stripped = line.strip()

        # 跳过分隔线和尾注
        if stripped in ("", "---") or stripped.startswith("*——"):
            continue

        # 一级标题
        if line.startswith("# ") and not line.startswith("## "):
            info["title"] = stripped.lstrip("# ")
            continue

        # 二级 / 三级标题（诗词标题或章节）
        if re.match(r"^#{2,3}\s", line):
            if current_section["lines"]:
                info["sections"].append(current_section)
            heading = re.sub(r"^#+\s*", "", line).strip()
            # 尝试提取 "《诗名》 — 作者" 或 "诗名 — 作者" 格式
            m = re.match(
                r"(?:[\d一二三四五六七八九十]+、)?\s*(?:《)?([^》—]+)(?:》)?\s*[—\-–─]\s*(.+)",
                heading,
            )
            if m:
                info["poems"].append({
                    "title": m.group(1).strip(),
                    "author": m.group(2).strip(),
                    "verses": [],
                })
            current_section = {"heading": heading, "lines": []}
            continue

        # 普通正文行
        current_section["lines"].append(stripped)

        # 尝试追加诗句到最后一首诗
        if info["poems"] and re.match(r"^[\u4e00-\u9fff，。、！？，\s]+$", stripped):
            info["poems"][-1]["verses"].append(stripped)

    if current_section["lines"]:
        info["sections"].append(current_section)

    return info


def display(info: dict, filename: str):
    width = 60
    sep = "─" * width

    print(f"\n{'📖 ' + filename + ' 📖':^{width}}")
    print(sep)

    if info["title"]:
        print(f"\n  \033[1;36m{info['title']}\033[0m")
    if info["epigraph"]:
        print(f"  \033[3m{info['epigraph']}\033[0m")

    if info["poems"]:
        for p in info["poems"]:
            print(f"\n  \033[1;33m《{p['title']}》\033[0m — \033[1;32m{p['author']}\033[0m")
            for v in p["verses"]:
                print(f"    {v}")
    else:
        for sec in info["sections"]:
            if sec["heading"]:
                print(f"\n  \033[1;33m{sec['heading']}\033[0m")
            for l in sec["lines"]:
                print(f"    {l}")

    # 统计
    char_count = sum(len(l) for sec in info["sections"] for l in sec["lines"])
    char_count += sum(len(v) for p in info["poems"] for v in p["verses"])
    poem_count = len(info["poems"])
    print(f"\n  \033[2m📊 {poem_count} 首诗 · 共 {char_count} 字\033[0m")
    print(sep)


def main():
    args = sys.argv[1:]
    files = []

    if args:
        for a in args:
            p = Path(a)
            if p.exists():
                files.append(p)
            else:
                print(f"⚠️  文件不存在: {a}")
    else:
        files = sorted(Path(".").glob("*.md"))

    if not files:
        print("📭 没有找到 Markdown 文件。")
        sys.exit(1)

    for f in files:
        lines = read_file(f)
        if lines is None:
            continue
        info = parse_md(lines)
        display(info, f.name)


if __name__ == "__main__":
    main()
