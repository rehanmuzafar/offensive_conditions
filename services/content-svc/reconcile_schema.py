"""Dev-only: reconcile the live DB to the ORM models.

The hand-written migrations drifted from the SQLAlchemy models (missing columns
like tags.color, machine_hints.point_penalty, …). This adds every column the
models declare but the live table lacks, as NULLABLE (safe on populated tables),
plus creates any wholly-missing tables. Idempotent.
"""

import sys

from sqlalchemy import create_engine, inspect, text

from app.core.config import get_settings
from app.db.base import Base
import app.models  # noqa: F401  -- registers all models on Base.metadata

settings = get_settings()
engine = create_engine(settings.database_sync_url)
dialect = engine.dialect

planned = []
with engine.connect() as conn:
    insp = inspect(conn)
    for table in Base.metadata.sorted_tables:
        schema = table.schema or "public"
        if not insp.has_table(table.name, schema=schema):
            planned.append(("CREATE_TABLE", table, None))
            continue
        existing = {c["name"] for c in insp.get_columns(table.name, schema=schema)}
        for col in table.columns:
            if col.name not in existing:
                planned.append(("ADD_COLUMN", table, col))

applied, failed = [], []
for kind, table, col in planned:
    schema = table.schema or "public"
    try:
        with engine.begin() as conn:
            if kind == "CREATE_TABLE":
                table.create(conn, checkfirst=True)
                applied.append(f"CREATE TABLE {schema}.{table.name}")
            else:
                coltype = col.type.compile(dialect=dialect)
                default = ""
                if col.server_default is not None:
                    arg = col.server_default.arg
                    default = f" DEFAULT {getattr(arg, 'text', arg)}"
                stmt = (
                    f'ALTER TABLE {schema}."{table.name}" '
                    f'ADD COLUMN IF NOT EXISTS "{col.name}" {coltype}{default}'
                )
                conn.execute(text(stmt))
                applied.append(stmt)
    except Exception as e:  # noqa: BLE001
        failed.append(f"{schema}.{table.name}.{getattr(col, 'name', '*')}: {str(e).splitlines()[0]}")

print("=== APPLIED ===")
for a in applied:
    print("  ", a)
print("=== FAILED ===")
for f in failed:
    print("  ", f)
engine.dispose()
sys.exit(1 if failed else 0)
