package kz.company.shop.datatransfer;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.math.BigInteger;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.util.Set;
import java.util.zip.ZipFile;
import kz.company.shop.files.service.ObjectStorageService;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

/** Only a newly created disposable database with a reserved test name is accepted. */
@EnabledIfEnvironmentVariable(named = "OVOSHI_SYNC_TEST_URL", matches = ".+")
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class DataTransferTrackingIntegrationTest {
    private Connection connection;
    private String url;
    private String user;
    @TempDir Path temporary;

    @BeforeAll
    void installOnEmptyIsolatedDatabase() throws Exception {
        url = System.getenv("OVOSHI_SYNC_TEST_URL");
        assertThat(url).matches("jdbc:postgresql://127\\.0\\.0\\.1:[0-9]+/ovoshi_sync_test_[a-z0-9]+");
        user = System.getenv().getOrDefault("OVOSHI_SYNC_TEST_USER", "sync_test");
        connection = DriverManager.getConnection(url, user, "");
        assertThat(number("select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p')")).isZero();
        execute("""
            create table products(id bigint primary key,name text,created_at timestamptz,updated_at timestamptz);
            create table product_images(id bigint primary key,product_id bigint references products(id),label text,created_at timestamptz);
            create table product_search_embeddings(product_id bigint primary key references products(id),content text,updated_at timestamptz);
            create table orders(id uuid primary key,label text,created_at timestamptz,updated_at timestamptz);
            create table order_items(id bigint primary key,order_id uuid references orders(id) on delete cascade,label text);
            create table procurement_projects(id bigint primary key,name text,created_at timestamptz,updated_at timestamptz);
            create table procurement_files(id bigint primary key,project_id bigint references procurement_projects(id),file_size bigint,created_at timestamptz);
            create table audit_logs(id bigint primary key,action text,entity_type text,entity_id text,created_at timestamptz);
            create table price_setting_groups(id uuid primary key,name text,created_at timestamptz,updated_at timestamptz);
            create table stock_documents(id uuid primary key,source_order_id uuid references orders(id),price_setting_group_id uuid references price_setting_groups(id),label text,created_at timestamptz,updated_at timestamptz);
            create table stock_document_versions(id bigint primary key,document_id uuid references stock_documents(id),action text,created_at timestamptz);
            create table flyway_schema_history(installed_rank integer primary key,version text,success boolean);
            insert into flyway_schema_history values(1,'134',true),(2,'135',true),(3,'136',true);
            insert into products values(1,'old one','2020-01-01 00:00:00+00','2020-01-02 00:00:00+00'),(2,'old two','2020-01-01 00:00:00+00','2020-01-02 00:00:00+00');
            insert into procurement_projects values(10,'project','2020-01-01 00:00:00+00','2020-01-02 00:00:00+00');
            insert into procurement_files values(11,10,4,'2020-01-01 00:00:00+00');
            insert into price_setting_groups values('00000000-0000-4000-8000-000000000002','group','2020-01-01 00:00:00+00','2020-01-02 00:00:00+00');
            insert into orders values('00000000-0000-4000-8000-000000000001','old order','2020-01-01 00:00:00+00','2020-01-02 00:00:00+00');
            """);
        for (String migration : new String[] {"V135__data_transfer_change_tracking.sql", "V136__preserve_recreated_sync_records.sql"}) {
            try (var stream = getClass().getResourceAsStream("/db/migration/" + migration)) {
                execute(new String(stream.readAllBytes(), java.nio.charset.StandardCharsets.UTF_8));
            }
        }
    }

    @BeforeEach void begin() throws Exception { connection.setAutoCommit(false); }
    @AfterEach void rollback() throws Exception { connection.rollback(); connection.setAutoCommit(true); }
    @AfterAll void close() throws Exception { if (connection != null) connection.close(); }

    @Test
    void historicalRowsHaveUnknownModificationAndInstanceIsPersistent() throws Exception {
        assertThat(number("select count(*) from sync_table_policies")).isEqualTo(11);
        assertThat(number("select count(*) from sync_rows where modified_at is not null")).isZero();
        String instance = text("select instance_id::text from sync_instance");
        execute("select sync_install_tracking()");
        assertThat(text("select instance_id::text from sync_instance")).isEqualTo(instance);
        assertThat(number("select count(*) from sync_rows")).isEqualTo(6);
    }

    @Test
    void mutableChildKeepsUidAndTouchesOldAndNewAggregateThenCreatesTombstone() throws Exception {
        execute("insert into product_images values(7,1,'first',clock_timestamp())");
        String uid = text("select uid::text from sync_rows where table_name='product_images' and not deleted");
        String before = clock("products", "1");
        execute("update product_images set label='second' where id=7");
        assertThat(text("select uid::text from sync_rows where table_name='product_images' and not deleted")).isEqualTo(uid);
        assertThat(new BigInteger(clock("products", "1"))).isGreaterThan(new BigInteger(before));
        execute("update product_images set product_id=2 where id=7");
        assertThat(clock("products", "2")).isNotNull();
        execute("delete from product_images where id=7");
        assertThat(text("select uid::text from sync_rows where table_name='product_images' and deleted")).isEqualTo(uid);
        assertThat(text("select aggregate_pk->>'id' from sync_rows where table_name='product_images' and deleted")).isEqualTo("2");
        execute("insert into product_images values(7,2,'third',clock_timestamp())");
        assertThat(text("select uid::text from sync_rows where table_name='product_images' and not deleted")).isNotEqualTo(uid);
        assertThat(number("select generation from sync_rows where table_name='product_images' and not deleted")).isEqualTo(2);
    }

    @Test
    void orderItemDeleteAdvancesOrderClockAndPreservesUuidRoot() throws Exception {
        execute("insert into order_items values(8,'00000000-0000-4000-8000-000000000001','one')");
        String previous = clock("orders", "00000000-0000-4000-8000-000000000001");
        execute("delete from order_items where id=8");
        assertThat(new BigInteger(clock("orders", "00000000-0000-4000-8000-000000000001"))).isGreaterThan(new BigInteger(previous));
        assertThat(text("select aggregate_table from sync_rows where table_name='order_items'")).isEqualTo("orders");
    }

    @Test
    void importedFutureMicrosecondsAreExactAndNextLocalOrChildMutationAdvancesThem() throws Exception {
        String uid = text("select uid::text from sync_rows where table_name='products' and pk='{" + "\"id\":\"1\"}'::jsonb");
        String future = "9007199254740993";
        execute("set local ovoshi.sync_tracking='off'");
        try (var statement = connection.prepareStatement("select sync_seed('products',?::uuid,'{\"id\":\"1\"}'::jsonb,?,false,1)")) {
            statement.setString(1,uid); statement.setString(2,future); statement.execute();
        }
        assertThat(clock("products", "1")).isEqualTo(future);
        execute("update products set name='remote adopted' where id=1");
        assertThat(clock("products", "1")).isEqualTo(future);
        execute("set local ovoshi.sync_tracking='on'");
        execute("update products set name='local change' where id=1");
        assertThat(clock("products", "1")).isEqualTo(new BigInteger(future).add(BigInteger.ONE).toString());
        execute("insert into product_images values(7,1,'child',clock_timestamp())");
        assertThat(clock("products", "1")).isEqualTo(new BigInteger(future).add(BigInteger.TWO).toString());
    }

    @Test
    void derivedEmbeddingRefreshDoesNotAdvanceBusinessProductClock() throws Exception {
        assertThat(clock("products", "1")).isNull();
        execute("insert into product_search_embeddings values(1,'derived',clock_timestamp())");
        assertThat(clock("products", "1")).isNull();
        assertThat(clock("product_search_embeddings", "1")).isNotNull();
        assertThat(text("select aggregate_table from sync_rows where table_name='product_search_embeddings'")).isEqualTo("products");
    }

    @Test
    void auditedSameSizeFileEditAdvancesFileAndProjectWithExactMonotonicClock() throws Exception {
        String uid=text("select uid::text from sync_rows where table_name='procurement_files'");
        String future="9007199254740993";
        execute("set local ovoshi.sync_tracking='off'");
        try(var statement=connection.prepareStatement("select sync_seed('procurement_files',?::uuid,'{\"id\":\"11\"}'::jsonb,?,false,1,'procurement_projects','{\"id\":\"10\"}'::jsonb)")) {
            statement.setString(1,uid);statement.setString(2,future);statement.execute();
        }
        execute("set local ovoshi.sync_tracking='on'");
        execute("update procurement_files set file_size=file_size where id=11");
        assertThat(clock("procurement_files","11")).isEqualTo(future);
        execute("insert into audit_logs values(1,'UPDATE','PROCUREMENT_FILE','11',clock_timestamp())");
        String next=new BigInteger(future).add(BigInteger.ONE).toString();
        assertThat(clock("procurement_files","11")).isEqualTo(next);
        assertThat(clock("procurement_projects","10")).isEqualTo(next);
        assertThat(text("select uid::text from sync_rows where table_name='procurement_files'")).isEqualTo(uid);
        execute("insert into audit_logs values(2,'READ','PROCUREMENT_FILE','11',clock_timestamp())");
        execute("insert into audit_logs values(3,'UPDATE','PRODUCT','11',clock_timestamp())");
        execute("update audit_logs set entity_type='PROCUREMENT_FILE' where id=3");
        execute("insert into audit_logs values(4,'UPDATE','PROCUREMENT_FILE','99',clock_timestamp())");
        assertThat(clock("procurement_files","11")).isEqualTo(next);
        assertThat(number("select count(*) from sync_rows where table_name='procurement_files'")).isEqualTo(1);
    }

    @Test
    void groupedPriceDocumentAndItsVersionsTouchBatchWhileOrderOwnershipHasPriority() throws Exception {
        String group="00000000-0000-4000-8000-000000000002";
        String order="00000000-0000-4000-8000-000000000001";
        String document="00000000-0000-4000-8000-000000000003";
        execute("insert into stock_documents values('"+document+"',null,'"+group+"','draft',clock_timestamp(),clock_timestamp())");
        String initial=clock("price_setting_groups",group);
        assertThat(initial).isNotNull();
        execute("update stock_documents set label='changed' where id='"+document+"'");
        assertThat(new BigInteger(clock("price_setting_groups",group))).isGreaterThan(new BigInteger(initial));
        String beforeVersion=clock("price_setting_groups",group);
        execute("insert into stock_document_versions values(1,'"+document+"','UPDATE',clock_timestamp())");
        assertThat(new BigInteger(clock("price_setting_groups",group))).isGreaterThan(new BigInteger(beforeVersion));
        assertThat(text("select aggregate_table from sync_rows where table_name='stock_document_versions'")).isEqualTo("price_setting_groups");
        String childUid=text("select uid::text from sync_rows where table_name='stock_document_versions' and pk->>'id'='1'");
        String childClock=clock("stock_document_versions","1");
        execute("insert into stock_document_versions values(11,'"+document+"','OLD',clock_timestamp())");
        execute("delete from stock_document_versions where id=11");
        String secondGroup="00000000-0000-4000-8000-000000000004";
        execute("insert into price_setting_groups values('"+secondGroup+"','second',clock_timestamp(),clock_timestamp())");
        execute("update stock_documents set price_setting_group_id='"+secondGroup+"' where id='"+document+"'");
        assertThat(text("select aggregate_pk->>'id' from sync_rows where table_name='stock_document_versions' and pk->>'id'='1'")).isEqualTo(secondGroup);
        assertThat(text("select aggregate_pk->>'id' from sync_rows where table_name='stock_document_versions' and pk->>'id'='11'")).isEqualTo(group);
        assertThat(text("select uid::text from sync_rows where table_name='stock_document_versions' and pk->>'id'='1'")).isEqualTo(childUid);
        assertThat(clock("stock_document_versions","1")).isEqualTo(childClock);
        // Native accepted parent changes also refresh unchanged children while tracking is off.
        execute("set local ovoshi.sync_tracking='off'");
        execute("update stock_documents set price_setting_group_id='"+group+"' where id='"+document+"'");
        String documentUid=text("select uid::text from sync_rows where table_name='stock_documents'");
        try(var statement=connection.prepareStatement("select sync_seed('stock_documents',?::uuid,?::jsonb,?,false,1,'price_setting_groups',?::jsonb)")) {
            statement.setString(1,documentUid);statement.setString(2,"{\"id\":\""+document+"\"}");
            statement.setString(3,clock("stock_documents",document));statement.setString(4,"{\"id\":\""+group+"\"}");statement.execute();
        }
        execute("set local ovoshi.sync_tracking='on'");
        assertThat(text("select aggregate_pk->>'id' from sync_rows where table_name='stock_document_versions' and pk->>'id'='1'")).isEqualTo(group);
        assertThat(clock("stock_document_versions","1")).isEqualTo(childClock);
        execute("update stock_documents set source_order_id='"+order+"' where id='"+document+"'");
        String afterReparent=clock("price_setting_groups",group);
        String orderBefore=clock("orders",order);
        execute("insert into stock_document_versions values(2,'"+document+"','POST',clock_timestamp())");
        assertThat(clock("price_setting_groups",group)).isEqualTo(afterReparent);
        assertThat(new BigInteger(clock("orders",order))).isGreaterThan(new BigInteger(orderBefore));
        assertThat(text("select aggregate_table from sync_rows where table_name='stock_document_versions' and pk->>'id'='2'")).isEqualTo("orders");
    }

    @Test
    void fullExporterKeepsV1BusinessVersionAndStreamsV2Metadata() throws Exception {
        var storage = mock(ObjectStorageService.class);
        when(storage.listObjectKeys()).thenReturn(Set.of());
        var service = new DataTransferExportService(new DriverManagerDataSource(url,user,""),
                new ObjectMapper(),storage,new DataTransferBarrier(),temporary.toString());
        var mapper = new ObjectMapper();
        try (var archive = service.export(); var zip = new ZipFile(archive.path().toFile())) {
            var manifest = mapper.readTree(zip.getInputStream(zip.getEntry("manifest.json")));
            assertThat(manifest.path("schemaVersion").asText()).isEqualTo("134");
            assertThat(manifest.has("sync")).isFalse();
            assertThat(manifest.path("tables").size()).isEqualTo(11);
        }
        try (var archive = service.export(2); var zip = new ZipFile(archive.path().toFile())) {
            var manifest = mapper.readTree(zip.getInputStream(zip.getEntry("manifest.json")));
            assertThat(manifest.path("schemaVersion").asText()).isEqualTo("136");
            assertThat(manifest.path("sync").path("rowCount").asLong()).isEqualTo(6);
            assertThat(zip.getEntry("sync/rows.jsonl")).isNotNull();
        }
    }

    @Test
    void historicalTombstoneSeededAfterRecreatedRowKeepsTheActiveIncarnation() throws Exception {
        String currentUid = "00000000-0000-4000-8000-000000000003";
        String historicalUid = "ffffffff-ffff-4fff-8fff-ffffffffffff";
        execute("set local ovoshi.sync_tracking='off'");
        try (var statement = connection.prepareStatement(
                "select sync_seed('products',?::uuid,'{\"id\":\"1\"}'::jsonb,?, ?,?,null,null,null)")) {
            statement.setString(1,currentUid); statement.setString(2,"2000000");
            statement.setBoolean(3,false); statement.setLong(4,3); statement.execute();
            // Export ordering by UID can place an older deleted generation after the active one.
            statement.setString(1,historicalUid); statement.setString(2,"1000000");
            statement.setBoolean(3,true); statement.setLong(4,2); statement.execute();
        }
        assertThat(text("select uid::text from sync_rows where table_name='products' and pk=jsonb_build_object('id','1') and not deleted")).isEqualTo(currentUid);
        assertThat(number("select generation from sync_rows where uid='"+currentUid+"'::uuid")).isEqualTo(3);
        assertThat(number("select count(*) from sync_rows where uid='"+historicalUid+"'::uuid and deleted and generation=2")).isEqualTo(1);
        assertThat(number("select count(*) from products where id=1")).isEqualTo(1);
        // A deletion of the current UID must still work; only a different historical UID is harmless.
        execute("delete from products where id=1");
        try (var statement = connection.prepareStatement(
                "select sync_seed('products',?::uuid,'{\"id\":\"1\"}'::jsonb,'3000000',true,3,null,null,null)")) {
            statement.setString(1,currentUid); statement.execute();
        }
        assertThat(number("select count(*) from sync_rows where table_name='products' and pk=jsonb_build_object('id','1') and not deleted")).isZero();
        assertThat(number("select count(*) from sync_rows where uid='"+currentUid+"'::uuid and deleted")).isEqualTo(1);
    }

    private String clock(String table, String id) throws Exception {
        String key = table.equals("product_search_embeddings") ? "product_id" : "id";
        try (var statement = connection.prepareStatement("select (extract(epoch from modified_at)*1000000)::bigint::text from sync_rows where table_name=? and pk->>?=? and not deleted")) {
            statement.setString(1,table);statement.setString(2,key);statement.setString(3,id);
            try (var result = statement.executeQuery()) { assertThat(result.next()).isTrue();return result.getString(1); }
        }
    }
    private long number(String sql) throws Exception { return Long.parseLong(text(sql)); }
    private String text(String sql) throws Exception {
        try (var statement = connection.createStatement(); var result = statement.executeQuery(sql)) {
            assertThat(result.next()).isTrue();return result.getString(1);
        }
    }
    private void execute(String sql) throws Exception { try (var statement = connection.createStatement()) { statement.execute(sql); } }
}
