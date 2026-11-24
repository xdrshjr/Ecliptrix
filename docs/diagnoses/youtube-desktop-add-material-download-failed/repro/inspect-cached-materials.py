"""列出桌面端数据库里所有 YouTube 观看页的 cached_materials 行（只读）。

用法（仓库根目录）：
    python -X utf8 docs/diagnoses/youtube-desktop-add-material-download-failed/repro/inspect-cached-materials.py

默认读 %APPDATA%\\ecliptrix-desktop\\data\\ecliptrix.db；
可用 --db 指向别的库（例如 .agentmesh 下的临时实例）。
"""
import argparse
import os
import pathlib
import sqlite3
import sys


def default_db():
    appdata = os.environ.get('APPDATA')
    if not appdata:
        return None
    return pathlib.Path(appdata) / 'ecliptrix-desktop' / 'data' / 'ecliptrix.db'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--db', default=None, help='path to ecliptrix.db')
    args = parser.parse_args()

    db = pathlib.Path(args.db) if args.db else default_db()
    if db is None or not db.is_file():
        print('database not found: %s' % db)
        return 2

    con = sqlite3.connect('file:%s?mode=ro' % db.as_posix(), uri=True)
    cur = con.cursor()
    cur.execute(
        "select source, source_id, status, file_size, "
        "substr(coalesce(error_message, ''), 1, 90), source_url "
        "from cached_materials "
        "where source_url like '%youtube.com/watch%' "
        "order by created_at desc"
    )
    rows = cur.fetchall()
    print('db: %s' % db)
    if not rows:
        print('no YouTube watch-page rows (bug not reproduced on this profile)')
        return 0
    for source, source_id, status, size, err, url in rows:
        print('-' * 90)
        print('source=%s source_id=%s status=%s file_size=%s' % (source, source_id, status, size))
        print('url=%s' % url)
        print('error_message=%s' % (err or '').replace('\n', ' / '))
    print('-' * 90)
    print('%d row(s) found' % len(rows))
    return 0


if __name__ == '__main__':
    sys.exit(main())
