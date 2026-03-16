#!/bin/bash
# ==============================================================================
# Ecliptrix Database Migration Script
#
# Usage:
#   bash migrate.sh              # Run all pending migrations
#   bash migrate.sh v1.1         # Run migrations from v1.1 onward
#   bash migrate.sh --status     # Show migration status
#   bash migrate.sh --reset      # Reset migration history (dangerous! does not drop tables)
# ==============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATIONS_DIR="$SCRIPT_DIR/migrations"

# ---------- Colors ----------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info()  { echo -e "${BLUE}[INFO]${NC} $1"; }
log_ok()    { echo -e "${GREEN}[OK]${NC} $1"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# ---------- Check prerequisites ----------
check_prerequisites() {
    if ! command -v psql &>/dev/null; then
        log_error "psql not found. Please install PostgreSQL client tools."
        log_error "  Ubuntu/Debian: sudo apt install postgresql-client"
        log_error "  macOS: brew install libpq"
        exit 1
    fi
}

# ---------- Load database connection config ----------
load_db_config() {
    local env_file="$SCRIPT_DIR/.env"
    if [ ! -f "$env_file" ]; then
        log_error ".env file not found: $env_file"
        exit 1
    fi

    # Read DATABASE_URL from .env (format: postgresql+asyncpg://user:pass@host:port/dbname)
    local db_url
    db_url=$(grep -E "^DATABASE_URL=" "$env_file" | head -1 | cut -d'=' -f2-)
    if [ -z "$db_url" ]; then
        log_error "DATABASE_URL not found in .env"
        exit 1
    fi

    # Strip +asyncpg to get a psql-compatible URL
    DB_URL=$(echo "$db_url" | sed 's/+asyncpg//')

    # Parse components for display (using Python for robust URL parsing)
    if command -v python3 &>/dev/null; then
        eval "$(python3 -c "
from urllib.parse import urlparse
u = urlparse('$DB_URL')
print(f'DB_HOST={u.hostname or \"localhost\"}')
print(f'DB_PORT={u.port or 5432}')
print(f'DB_NAME={u.path.lstrip(\"/\").split(\"?\")[0]}')
" 2>/dev/null)" || {
            # Fallback to simple regex if python fails
            DB_HOST=$(echo "$db_url" | sed -E 's|.*@([^:/@]+)[:/@].*|\1|')
            DB_PORT=$(echo "$db_url" | sed -E 's|.*:([0-9]+)/.*|\1|')
            DB_NAME=$(echo "$db_url" | sed -E 's|.*/([^?]+).*|\1|')
        }
    else
        DB_HOST=$(echo "$db_url" | sed -E 's|.*@([^:/@]+)[:/@].*|\1|')
        DB_PORT=$(echo "$db_url" | sed -E 's|.*:([0-9]+)/.*|\1|')
        DB_NAME=$(echo "$db_url" | sed -E 's|.*/([^?]+).*|\1|')
    fi
}

# ---------- Run a psql command, showing errors on failure ----------
run_psql() {
    # Run psql with the given arguments; stderr is shown on failure
    local err_file
    err_file=$(mktemp)
    if ! psql "$DB_URL" "$@" 2>"$err_file"; then
        local err_msg
        err_msg=$(cat "$err_file")
        rm -f "$err_file"
        if [ -n "$err_msg" ]; then
            log_error "psql error: $err_msg"
        fi
        return 1
    fi
    rm -f "$err_file"
    return 0
}

# ---------- Ensure migration history table exists ----------
ensure_migration_table() {
    run_psql -q -c "
        CREATE TABLE IF NOT EXISTS _migration_history (
            id SERIAL PRIMARY KEY,
            version VARCHAR(20) NOT NULL,
            script_name VARCHAR(255) NOT NULL,
            applied_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            checksum VARCHAR(64),
            UNIQUE(version, script_name)
        );
    " || {
        log_error "Cannot connect to database. Check DATABASE_URL in .env and ensure PostgreSQL is running."
        exit 1
    }
}

# ---------- Check if a migration has already been applied ----------
is_migration_applied() {
    local version="$1"
    local script="$2"
    local count
    count=$(psql "$DB_URL" -t -A -c "
        SELECT COUNT(*) FROM _migration_history
        WHERE version = \$\$${version}\$\$ AND script_name = \$\$${script}\$\$;
    " 2>/dev/null)
    [ "$count" -gt 0 ]
}

# ---------- Record a migration as applied ----------
record_migration() {
    local version="$1"
    local script="$2"
    local checksum="$3"
    run_psql -q -c "
        INSERT INTO _migration_history (version, script_name, checksum)
        VALUES (\$\$${version}\$\$, \$\$${script}\$\$, \$\$${checksum}\$\$)
        ON CONFLICT (version, script_name) DO NOTHING;
    "
}

# ---------- Compute file checksum ----------
file_checksum() {
    if command -v sha256sum &>/dev/null; then
        sha256sum "$1" | cut -d' ' -f1
    elif command -v shasum &>/dev/null; then
        shasum -a 256 "$1" | cut -d' ' -f1
    else
        echo "unknown"
    fi
}

# ---------- Show migration status ----------
show_status() {
    load_db_config
    ensure_migration_table

    echo ""
    log_info "Database: $DB_HOST:$DB_PORT/$DB_NAME"
    echo ""
    printf "%-10s  %-40s  %-8s  %s\n" "VERSION" "SCRIPT" "STATUS" "APPLIED AT"
    printf "%-10s  %-40s  %-8s  %s\n" "-------" "------" "------" "----------"

    for version_dir in "$MIGRATIONS_DIR"/v*/; do
        [ -d "$version_dir" ] || continue
        local version
        version=$(basename "$version_dir")

        for sql_file in "$version_dir"*.sql; do
            [ -f "$sql_file" ] || continue
            local script
            script=$(basename "$sql_file")

            local applied_at
            applied_at=$(psql "$DB_URL" -t -A -c "
                SELECT to_char(applied_at, 'YYYY-MM-DD HH24:MI:SS')
                FROM _migration_history
                WHERE version = \$\$${version}\$\$ AND script_name = \$\$${script}\$\$;
            " 2>/dev/null)

            if [ -n "$applied_at" ]; then
                printf "%-10s  %-40s  ${GREEN}%-8s${NC}  %s\n" "$version" "$script" "applied" "$applied_at"
            else
                printf "%-10s  %-40s  ${YELLOW}%-8s${NC}  %s\n" "$version" "$script" "pending" "-"
            fi
        done
    done
    echo ""
}

# ---------- Reset migration history ----------
reset_migrations() {
    load_db_config
    log_warn "This will DELETE all migration history records (tables/data are NOT dropped)"
    log_warn "Type 'yes' to confirm:"
    read -p "> " confirm
    if [ "$confirm" = "yes" ]; then
        run_psql -q -c "DROP TABLE IF EXISTS _migration_history;"
        log_ok "Migration history reset"
    else
        log_info "Cancelled"
    fi
}

# ---------- Run migrations ----------
run_migrations() {
    local start_version="${1:-}"

    load_db_config
    ensure_migration_table

    log_info "Database: $DB_HOST:$DB_PORT/$DB_NAME"
    log_info "Migrations directory: $MIGRATIONS_DIR"
    echo ""

    local total_applied=0
    local total_skipped=0
    local started=true

    if [ -n "$start_version" ]; then
        started=false
        log_info "Starting from version $start_version"
    fi

    # Iterate version directories in sorted order
    for version_dir in $(ls -d "$MIGRATIONS_DIR"/v*/ 2>/dev/null | sort -V); do
        [ -d "$version_dir" ] || continue
        local version
        version=$(basename "$version_dir")

        # Skip versions before start_version
        if [ "$started" = false ]; then
            if [ "$version" = "$start_version" ]; then
                started=true
            else
                continue
            fi
        fi

        # Execute each SQL script in sorted order
        for sql_file in $(ls "$version_dir"*.sql 2>/dev/null | sort); do
            [ -f "$sql_file" ] || continue
            local script
            script=$(basename "$sql_file")
            local checksum
            checksum=$(file_checksum "$sql_file")

            if is_migration_applied "$version" "$script"; then
                total_skipped=$((total_skipped + 1))
                continue
            fi

            log_info "Executing: $version/$script ..."

            if psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$sql_file" 2>&1; then
                record_migration "$version" "$script" "$checksum"
                log_ok "Done: $version/$script"
                total_applied=$((total_applied + 1))
            else
                log_error "Failed: $version/$script"
                log_error "Migration aborted. Fix the issue and re-run."
                exit 1
            fi
        done
    done

    echo ""
    if [ $total_applied -eq 0 ]; then
        log_ok "Database is up to date (skipped $total_skipped already-applied scripts)"
    else
        log_ok "Migration complete: applied $total_applied scripts, skipped $total_skipped"
    fi
}

# ---------- Main entry ----------
check_prerequisites

case "${1:-}" in
    --status)
        show_status
        ;;
    --reset)
        reset_migrations
        ;;
    --help|-h)
        echo "Usage: bash migrate.sh [option]"
        echo ""
        echo "Options:"
        echo "  (none)         Run all pending migrations"
        echo "  v1.1           Run migrations starting from a specific version"
        echo "  --status       Show migration status"
        echo "  --reset        Reset migration history (does NOT drop tables)"
        echo "  --help         Show this help"
        ;;
    v*)
        run_migrations "$1"
        ;;
    *)
        run_migrations
        ;;
esac
