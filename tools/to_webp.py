"""把首屏预加载的立绘/界面图转成 WebP(质量 85,透明图保留 alpha),并删除原 PNG/JPG。
可重跑:已是 .webp 的跳过。用法:python -I tools/to_webp.py
"""
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent / 'assets'
DIRS = ['units', 'structures', 'spells', 'emblems', 'ui']

before = after = 0
for d in DIRS:
    for src in sorted((ROOT / d).glob('*')):
        if src.suffix.lower() not in ('.png', '.jpg', '.jpeg'):
            continue
        dst = src.with_suffix('.webp')
        im = Image.open(src)
        im.load()
        keep_alpha = im.mode in ('RGBA', 'LA') or 'transparency' in im.info
        im = im.convert('RGBA' if keep_alpha else 'RGB')
        im.save(dst, 'WEBP', quality=85, method=6)
        before += src.stat().st_size
        after += dst.stat().st_size
        src.unlink()
print(f'{before / 1e6:.1f} MB -> {after / 1e6:.1f} MB')
