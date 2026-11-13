#!/usr/bin/env python3
"""一次性数据迁移：把 catalog.json 里遗留的纯字符串多语言字段升级为 {"zh": "..."}。

背景：`LocalizedText` 之前是 `string`，站点设置里的标签目录（display_name /
description）、模组的 summary / description 都存成裸中文；现在统一成「按语言存放」的
对象。旧值没有语言标记，只能按「默认语言即中文」补 zh 键。

用法：
    python scripts/migrate_localized_text.py /path/to/catalog.json            # 预览
    python scripts/migrate_localized_text.py /path/to/catalog.json --write    # 落盘（先备份）

本项目处于快速迭代阶段，不在 Go 代码里保留对旧形状的兼容分支；
测试实例 100.72.137.92 上的 catalog.json 只需跑这一次。
"""
from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path

LOCALIZED_KEYS = ("display_name", "description", "summary")


def to_localized(value):
    """纯字符串补成 {zh: value}；已经是对象的一律不动。"""
    if isinstance(value, str):
        return {"zh": value}
    return value


def migrate_tag(tag: dict) -> int:
    changed = 0
    for key in ("display_name", "description"):
        if key in tag:
            before = tag[key]
            after = to_localized(before)
            if after is not before and after != before:
                tag[key] = after
                changed += 1
            elif not isinstance(before, str) and not isinstance(before, dict):
                # null 之类：删掉，让「未提供」和「空字符串」在语义上一致。
                del tag[key]
                changed += 1
    return changed


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("catalog", type=Path, help="catalog.json 路径")
    parser.add_argument("--write", action="store_true", help="写回文件（默认只预览）")
    args = parser.parse_args()

    data = json.loads(args.catalog.read_text(encoding="utf-8"))
    changed = 0

    tag_catalog = (data.get("settings") or {}).get("tag_catalog") or []
    for group in tag_catalog:
        changed += migrate_tag(group)
        for child in group.get("children") or []:
            changed += migrate_tag(child)

    for mod in data.get("mods") or []:
        for key in ("summary", "description"):
            if key in mod:
                before = mod[key]
                after = to_localized(before)
                if after != before:
                    mod[key] = after
                    changed += 1

    print(f"待升级字段：{changed} 个")
    if not args.write:
        print("（预览模式，未写入；加 --write 落盘）")
        return 0
    if changed == 0:
        return 0

    backup = args.catalog.with_suffix(args.catalog.suffix + ".bak")
    shutil.copy2(args.catalog, backup)
    args.catalog.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"已写入 {args.catalog}（备份：{backup}）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
