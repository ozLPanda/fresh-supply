package kz.company.shop.migration;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.Set;
import java.util.regex.Pattern;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.core.io.support.PathMatchingResourcePatternResolver;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;

/** Uses two externally provisioned, empty test databases; never cleans or drops a database. */
@EnabledIfEnvironmentVariable(named = "MIGRATION_TEST_FRESH_URL", matches = ".+")
class FreshDatabaseMigrationIntegrationTest {
    private static final Pattern TEST_URL =
            Pattern.compile("jdbc:postgresql://[^/]+/(fresh_migration_test_[A-Za-z0-9_]+)");
    private static final Set<String> SYSTEM_TABLES =
            Set.of(
                    "flyway_schema_history", "users", "roles", "permissions", "role_permissions",
                    "user_roles", "user_permissions", "wallets", "project_settings", "warehouses");

    @TempDir Path legacyMigrations;

    @Test
    void startsEmptyAndPreservesExistingInstallations() throws Exception {
        String freshUrl = requiredEnvironment("MIGRATION_TEST_FRESH_URL");
        String legacyUrl = requiredEnvironment("MIGRATION_TEST_LEGACY_URL");
        String freshDatabase = testDatabase(freshUrl);
        String legacyDatabase = testDatabase(legacyUrl);
        assertThat(freshDatabase).isNotEqualTo(legacyDatabase);
        String user = requiredEnvironment("MIGRATION_TEST_USER");
        String password = requiredEnvironment("MIGRATION_TEST_PASSWORD");

        try (Connection fresh = DriverManager.getConnection(freshUrl, user, password);
                Connection legacy = DriverManager.getConnection(legacyUrl, user, password)) {
            assertEmptyTestDatabase(fresh, freshDatabase);
            assertEmptyTestDatabase(legacy, legacyDatabase);

            Flyway freshFlyway = flyway(freshUrl, user, password, "classpath:db/migration");
            freshFlyway.migrate();
            freshFlyway.validate();
            assertSingleAdministrator(fresh);
            for (String table : strings(fresh, "select tablename from pg_tables where schemaname = 'public'")) {
                if (!SYSTEM_TABLES.contains(table)) {
                    assertThat(count(fresh, table)).as("empty business table %s", table).isZero();
                }
            }
            assertThat(number(fresh, "select count(*) from warehouses where code = 'MAIN' and active"))
                    .isEqualTo(1);
            assertThat(number(fresh, "select count(*) from wallets where balance = 0")).isEqualTo(1);
            assertThat(number(fresh, "select count(*) from flyway_schema_history where script like 'B015__%'"))
                    .isEqualTo(1);
            assertThat(number(fresh, "select count(*) from flyway_schema_history where script like 'V012__%' or script like 'V015__%'"))
                    .isZero();

            copyLegacyMigrations();
            flyway(legacyUrl, user, password, "filesystem:" + legacyMigrations).migrate();
            List<Long> existingCatalog = catalogCounts(legacy);
            assertThat(existingCatalog).allMatch(value -> value > 0);
            String existingAdminHash = strings(legacy, "select password_hash from users").getFirst();
            Flyway legacyFlyway = flyway(legacyUrl, user, password, "classpath:db/migration");
            legacyFlyway.migrate();
            legacyFlyway.validate();
            assertThat(catalogCounts(legacy)).isEqualTo(existingCatalog);
            assertSingleAdministrator(legacy);
            assertThat(strings(legacy, "select password_hash from users")).containsExactly(existingAdminHash);
            assertThat(number(legacy, "select count(*) from flyway_schema_history where script like 'B015__%'"))
                    .isZero();
            assertThat(administratorPermissions(fresh)).isEqualTo(administratorPermissions(legacy));
            assertThat(columns(fresh)).isEqualTo(columns(legacy));
            assertThat(indexes(fresh)).isEqualTo(indexes(legacy));

            execute(fresh, "insert into categories(name_ru, name_kk, slug) values ('Sentinel', 'Sentinel', 'migration-sentinel')");
            execute(fresh, "insert into products(sku, name_ru, name_kk, price, category_id) select 'MIGRATION-SENTINEL', 'Sentinel', 'Sentinel', 1, id from categories where slug = 'migration-sentinel'");
            assertThat(freshFlyway.migrate().migrationsExecuted).isZero();
            freshFlyway.validate();
            assertThat(catalogCounts(fresh)).containsExactly(1L, 1L, 0L);
            assertThat(strings(fresh, "select sku from products")).containsExactly("MIGRATION-SENTINEL");
            assertThat(strings(fresh, "select slug from categories")).containsExactly("migration-sentinel");
            assertSingleAdministrator(fresh);
        }
    }

    private void copyLegacyMigrations() throws Exception {
        int copied = 0;
        var resources =
                new PathMatchingResourcePatternResolver().getResources("classpath*:db/migration/V*.sql");
        for (var resource : resources) {
            String name = Objects.requireNonNull(resource.getFilename());
            if (!name.matches("V00[1-9]__.*|V01[0-5]__.*")) continue;
            try (var input = resource.getInputStream()) {
                Files.copy(input, legacyMigrations.resolve(name));
            }
            copied++;
        }
        assertThat(copied).isEqualTo(15);
    }

    private static Flyway flyway(String url, String user, String password, String location) {
        return Flyway.configure()
                .dataSource(url, user, password)
                .locations(location)
                .cleanDisabled(true)
                .load();
    }

    private static String requiredEnvironment(String name) {
        String value = System.getenv(name);
        assertThat(value).as("required test environment variable %s", name).isNotBlank();
        return value;
    }

    private static String testDatabase(String url) {
        var matcher = TEST_URL.matcher(url);
        assertThat(matcher.matches()).as("only dedicated fresh_migration_test_ databases are allowed").isTrue();
        return matcher.group(1);
    }

    private static void assertEmptyTestDatabase(Connection connection, String expectedName)
            throws SQLException {
        assertThat(strings(connection, "select current_database()")).containsExactly(expectedName);
        assertThat(number(connection, "select count(*) from information_schema.tables where table_schema not in ('pg_catalog', 'information_schema')"))
                .as("test database must be empty before running migrations")
                .isZero();
    }

    private static void assertSingleAdministrator(Connection connection) throws SQLException {
        assertThat(count(connection, "users")).isEqualTo(1);
        assertThat(number(connection, "select count(*) from users u join user_roles ur on ur.user_id = u.id join roles r on r.id = ur.role_id where u.active and u.deleted_at is null and r.active and r.code = 'administrator'"))
                .isEqualTo(1);
        String hash = strings(connection, "select password_hash from users").getFirst();
        assertThat(new BCryptPasswordEncoder().matches("password", hash)).isTrue();
        assertThat(administratorPermissions(connection))
                .contains("products.create", "categories.create", "users.create", "roles.create");
    }

    private static List<String> administratorPermissions(Connection connection) throws SQLException {
        return strings(connection, "select p.code from permissions p join role_permissions rp on rp.permission_id = p.id join roles r on r.id = rp.role_id where r.code = 'administrator' order by p.code");
    }

    private static List<Long> catalogCounts(Connection connection) throws SQLException {
        return List.of(count(connection, "categories"), count(connection, "products"), count(connection, "product_images"));
    }

    private static List<String> columns(Connection connection) throws SQLException {
        return strings(connection, "select concat_ws('|', table_name, column_name, ordinal_position, data_type, udt_name, character_maximum_length, numeric_precision, numeric_scale, is_nullable, column_default) from information_schema.columns where table_schema = 'public' and table_name <> 'flyway_schema_history' order by table_name, ordinal_position");
    }

    private static List<String> indexes(Connection connection) throws SQLException {
        return strings(connection, "select indexdef from pg_indexes where schemaname = 'public' and tablename <> 'flyway_schema_history' order by tablename, indexname");
    }

    private static long count(Connection connection, String table) throws SQLException {
        return number(connection, "select count(*) from \"" + table.replace("\"", "\"\"") + "\"");
    }

    private static long number(Connection connection, String sql) throws SQLException {
        return Long.parseLong(strings(connection, sql).getFirst());
    }

    private static List<String> strings(Connection connection, String sql) throws SQLException {
        List<String> values = new ArrayList<>();
        try (var statement = connection.createStatement();
                var rows = statement.executeQuery(sql)) {
            while (rows.next()) values.add(rows.getString(1));
        }
        return values;
    }

    private static void execute(Connection connection, String sql) throws SQLException {
        try (var statement = connection.createStatement()) {
            statement.executeUpdate(sql);
        }
    }
}
