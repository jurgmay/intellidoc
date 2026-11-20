/*
  IntelliDoc web application - core schema (ingest -> pack -> mailpiece -> batch)
  Target: Microsoft SQL Server (T-SQL)

  Scope of this first cut
    * Reference / configuration (accounts, brands, stock, envelopes, postal)
    * Ingest of H-POD export v6 (job, source, address, pack, options, passthrough,
      identifiers, inserts)
    * Address matching -> mailpiece, with the one-recipient-per-envelope rule enforced
      by the database itself
    * Batch identity and enclosing route

  NOT in this cut (to follow): pricing/invoicing, run sheets, spoils/returns, stock allocation,
  docketing, archiving, MRDF, reports, users/roles.

  Items marked "CONFIRM" are inferred from the FileMaker DDR and need your sign-off.
*/

CREATE SCHEMA idoc;
GO

/* ===========================================================================
   1. SETTINGS (single row)
   =========================================================================== */
CREATE TABLE idoc.settings (
    settings_id                         TINYINT       NOT NULL CONSTRAINT pk_settings PRIMARY KEY,
    -- Weight / thickness constants (replace the hard-coded 90gsm = 5.625g in FileMaker)
    a4_sheet_weight_g                   DECIMAL(6, 3) NOT NULL CONSTRAINT df_settings_sheet_wt DEFAULT (5.625),
    a4_sheet_thickness_mm               DECIMAL(5, 3) NOT NULL CONSTRAINT df_settings_sheet_th DEFAULT (0.100),
    -- Machine enclosing (FileMaker: Settings::minimumMailpiecesMachineEnclosing / maxSheetsMachineEnclosing)
    machine_enclosing_min_mailpieces    INT           NOT NULL CONSTRAINT df_settings_mach_min DEFAULT (25),
    machine_enclosing_max_sheets        INT           NOT NULL CONSTRAINT df_settings_mach_sheets DEFAULT (12),
    machine_enclosing_envelope_code     NVARCHAR(20)  NOT NULL CONSTRAINT df_settings_mach_env DEFAULT (N'C5'),
    hand_enclosing_max_sheets           INT           NOT NULL CONSTRAINT df_settings_hand_sheets DEFAULT (125),
    CONSTRAINT ck_settings_single_row CHECK (settings_id = 1)
);
GO

/* ===========================================================================
   2. PAPER, ENVELOPE SIZES, POSTAL
   =========================================================================== */
CREATE TABLE idoc.paper (
    paper_id        INT IDENTITY(1, 1) NOT NULL CONSTRAINT pk_paper PRIMARY KEY,
    name            NVARCHAR(100)      NOT NULL,  -- as received, e.g. 'A4 White'
    batch_name      NVARCHAR(100)      NOT NULL,  -- normalised for batching: 'A4 Plain' and 'A4 White' -> 'A4 WHITE'
    paper_code      NVARCHAR(50)       NULL,
    CONSTRAINT uq_paper_name UNIQUE (name)
);
GO

CREATE TABLE idoc.envelope_size (
    envelope_size_id INT IDENTITY(1, 1) NOT NULL CONSTRAINT pk_envelope_size PRIMARY KEY,
    code             NVARCHAR(20)       NOT NULL,  -- 'C5', 'C4', ...
    description      NVARCHAR(100)      NOT NULL,
    width_mm         DECIMAL(7, 2)      NULL,
    height_mm        DECIMAL(7, 2)      NULL,
    CONSTRAINT uq_envelope_size_code UNIQUE (code)
);
GO

CREATE TABLE idoc.postal_provider (
    postal_provider_id INT IDENTITY(1, 1) NOT NULL CONSTRAINT pk_postal_provider PRIMARY KEY,
    name               NVARCHAR(100)      NOT NULL,
    CONSTRAINT uq_postal_provider_name UNIQUE (name)
);
GO

CREATE TABLE idoc.postal_format (
    postal_format_id INT IDENTITY(1, 1) NOT NULL CONSTRAINT pk_postal_format PRIMARY KEY,
    name             NVARCHAR(50)       NOT NULL,  -- Letter, Large Letter, Small Parcel, Medium Parcel
    rank_order       TINYINT            NOT NULL,  -- smallest = 1; used to step up when limits are exceeded
    max_weight_g     INT                NOT NULL,
    max_thickness_mm DECIMAL(6, 2)      NULL,      -- FileMaker PostalFormats.maxDepth
    max_length_mm    DECIMAL(7, 2)      NULL,
    max_width_mm     DECIMAL(7, 2)      NULL,
    max_sheets       INT                NULL,      -- FileMaker proxy limits: Letter 16, Large Letter 125
    CONSTRAINT uq_postal_format_name UNIQUE (name),
    CONSTRAINT uq_postal_format_rank UNIQUE (rank_order)
);
GO

CREATE TABLE idoc.postal_service (
    postal_service_id  INT IDENTITY(1, 1) NOT NULL CONSTRAINT pk_postal_service PRIMARY KEY,
    postal_provider_id INT                NOT NULL CONSTRAINT fk_postal_service_provider REFERENCES idoc.postal_provider (postal_provider_id),
    postal_format_id   INT                NOT NULL CONSTRAINT fk_postal_service_format REFERENCES idoc.postal_format (postal_format_id),
    name               NVARCHAR(100)      NOT NULL,  -- e.g. '2nd Class', 'Signed For 1st Class'
    service_code       NVARCHAR(50)       NULL,
    is_signed_for      BIT                NOT NULL CONSTRAINT df_postal_service_signed DEFAULT (0),
    is_tracked         BIT                NOT NULL CONSTRAINT df_postal_service_tracked DEFAULT (0),
    is_recorded        BIT                NOT NULL CONSTRAINT df_postal_service_recorded DEFAULT (0),
    CONSTRAINT uq_postal_service UNIQUE (postal_provider_id, postal_format_id, name)
);
GO

-- One row per weight band of a service (FileMaker PostalServices rows). Prices belong to the pricing module.
CREATE TABLE idoc.postal_rate (
    postal_rate_id    INT IDENTITY(1, 1) NOT NULL CONSTRAINT pk_postal_rate PRIMARY KEY,
    postal_service_id INT                NOT NULL CONSTRAINT fk_postal_rate_service REFERENCES idoc.postal_service (postal_service_id),
    min_weight_g      INT                NOT NULL,
    max_weight_g      INT                NOT NULL,
    valid_from        DATE               NOT NULL,
    valid_to          DATE               NULL,
    cost              DECIMAL(10, 4)     NULL,
    sell_price        DECIMAL(10, 4)     NULL,
    CONSTRAINT ck_postal_rate_band CHECK (max_weight_g >= min_weight_g),
    CONSTRAINT uq_postal_rate UNIQUE (postal_service_id, min_weight_g, max_weight_g, valid_from)
);
GO

/* ===========================================================================
   3. ACCOUNTS, BRANDS, STOCK
   =========================================================================== */
CREATE TABLE idoc.passthrough_key (
    passthrough_key_id INT IDENTITY(1, 1) NOT NULL CONSTRAINT pk_passthrough_key PRIMARY KEY,
    name               NVARCHAR(100)      NOT NULL,
    CONSTRAINT uq_passthrough_key_name UNIQUE (name)
);
GO

CREATE TABLE idoc.identifier_type (
    identifier_type_id INT IDENTITY(1, 1) NOT NULL CONSTRAINT pk_identifier_type PRIMARY KEY,
    name               NVARCHAR(200)      NOT NULL,  -- XML ExtractionZone, e.g. 'MPAN'
    CONSTRAINT uq_identifier_type_name UNIQUE (name)
);
GO

-- FileMaker 'Customers': both submitting accounts (match XML OwnerAccount) and the grouping account (the customer).
CREATE TABLE idoc.account (
    account_id                  INT IDENTITY(1, 1) NOT NULL CONSTRAINT pk_account PRIMARY KEY,
    account_code               NVARCHAR(100)      NOT NULL,
    name                       NVARCHAR(200)      NOT NULL,
    parent_account_id          INT                NULL CONSTRAINT fk_account_parent REFERENCES idoc.account (account_id),
    grouping_account_id        INT                NULL CONSTRAINT fk_account_grouping REFERENCES idoc.account (account_id), -- NULL = this IS the customer
    -- Flags (read from the grouping account at ingest)
    is_address_matching        BIT                NOT NULL CONSTRAINT df_account_match DEFAULT (0),
    is_archive_mailpieces      BIT                NOT NULL CONSTRAINT df_account_archive DEFAULT (0),
    is_create_output_files     BIT                NOT NULL CONSTRAINT df_account_output DEFAULT (0),
    is_create_separate_batches BIT                NOT NULL CONSTRAINT df_account_sepbatch DEFAULT (0),
    is_nhs                     BIT                NOT NULL CONSTRAINT df_account_nhs DEFAULT (0),
    is_sso                     BIT                NOT NULL CONSTRAINT df_account_sso DEFAULT (0),
    is_same_day_service        BIT                NOT NULL CONSTRAINT df_account_sameday DEFAULT (0),
    is_use_mrdf                BIT                NOT NULL CONSTRAINT df_account_mrdf DEFAULT (0),
    is_testing                 BIT                NOT NULL CONSTRAINT df_account_testing DEFAULT (0),
    is_deleted                 BIT                NOT NULL CONSTRAINT df_account_deleted DEFAULT (0),
    colour_mode                TINYINT            NULL,
    mis_job_number             NVARCHAR(50)       NULL,
    return_address             NVARCHAR(500)      NULL,
    -- Passthrough keys that drive sequencing and batching (replace packSequenceJSON / batchingJSON)
    pack_sequence_key_id       INT                NULL CONSTRAINT fk_account_seqkey REFERENCES idoc.passthrough_key (passthrough_key_id),
    batching_key_id            INT                NULL CONSTRAINT fk_account_batchkey REFERENCES idoc.passthrough_key (passthrough_key_id),
    created_at                 DATETIME2(0)       NOT NULL CONSTRAINT df_account_created DEFAULT (SYSUTCDATETIME()),
    legacy_id                  UNIQUEIDENTIFIER   NULL,   -- FileMaker Customers.id (reference import only)
    CONSTRAINT uq_account_code UNIQUE (account_code)
);
GO
CREATE UNIQUE INDEX ux_account_legacy ON idoc.account (legacy_id) WHERE legacy_id IS NOT NULL;
GO

CREATE TABLE idoc.account_notification_email (
    account_id INT           NOT NULL CONSTRAINT fk_ane_account REFERENCES idoc.account (account_id),
    email      NVARCHAR(320) NOT NULL,
    CONSTRAINT pk_account_notification_email PRIMARY KEY (account_id, email)
);
GO

CREATE TABLE idoc.brand (
    brand_id   INT IDENTITY(1, 1) NOT NULL CONSTRAINT pk_brand PRIMARY KEY,
    account_id INT                NOT NULL CONSTRAINT fk_brand_account REFERENCES idoc.account (account_id),
    name       NVARCHAR(200)      NOT NULL,
    legacy_id  UNIQUEIDENTIFIER   NULL,
    CONSTRAINT uq_brand UNIQUE (account_id, name)
);
GO
CREATE UNIQUE INDEX ux_brand_legacy ON idoc.brand (legacy_id) WHERE legacy_id IS NOT NULL;
GO

-- Address-matching rules (FileMaker 'Address Match Rules'; replaces addressMatchJSON).
-- is_include = 1: the pack's passthrough value for this key is added to the match key.
-- is_include = 0: a pack with this key/value is EXCLUDED from matching and always gets its own envelope.
CREATE TABLE idoc.address_match_rule (
    address_match_rule_id INT IDENTITY(1, 1) NOT NULL CONSTRAINT pk_address_match_rule PRIMARY KEY,
    account_id            INT                NOT NULL CONSTRAINT fk_amr_account REFERENCES idoc.account (account_id),
    sequence_no           INT                NOT NULL,
    is_include            BIT                NOT NULL,
    passthrough_key_id    INT                NOT NULL CONSTRAINT fk_amr_key REFERENCES idoc.passthrough_key (passthrough_key_id),
    passthrough_value     NVARCHAR(400)      NULL,   -- required for exclude rules, NULL for include rules
    CONSTRAINT ck_amr_exclude_has_value CHECK (is_include = 1 OR passthrough_value IS NOT NULL)
);
GO

-- Order of packs inside a merged envelope (FileMaker 'PackSequenceRules'; replaces packSequenceJSON). CONFIRM mapping.
CREATE TABLE idoc.pack_sequence_rule (
    account_id        INT           NOT NULL CONSTRAINT fk_psr_account REFERENCES idoc.account (account_id),
    passthrough_value NVARCHAR(400) NOT NULL,   -- value of account.pack_sequence_key_id, e.g. 'Arrears'
    sequence_number   INT           NOT NULL,
    CONSTRAINT pk_pack_sequence_rule PRIMARY KEY (account_id, passthrough_value)
);
GO

-- Addressee texts that must never be merged because they do not identify one person: always their own envelope.
-- (Confirmed: anonymous addressees never merge. Global list; review the seed values at the bottom of this file.)
CREATE TABLE idoc.anonymous_addressee (
    normalised_text NVARCHAR(200) NOT NULL CONSTRAINT pk_anonymous_addressee PRIMARY KEY  -- upper case, punctuation stripped
);
GO

CREATE TABLE idoc.stock_item (
    stock_item_id        INT IDENTITY(1, 1) NOT NULL CONSTRAINT pk_stock_item PRIMARY KEY,
    parent_stock_item_id INT                NULL CONSTRAINT fk_stock_parent REFERENCES idoc.stock_item (stock_item_id), -- linked items
    account_id           INT                NULL CONSTRAINT fk_stock_account REFERENCES idoc.account (account_id),
    brand_id             INT                NULL CONSTRAINT fk_stock_brand REFERENCES idoc.brand (brand_id),
    stock_code           NVARCHAR(50)       NULL,   -- NULL until the warehouse code is assigned; unique when present
    stock_type           NVARCHAR(50)       NULL,   -- 'Outer Envelope', 'Booklet', 'Leaflet', ...
    reference            NVARCHAR(200)      NULL,
    product_code         NVARCHAR(50)       NULL,
    max_sheets           INT                NULL,   -- most A4 90gsm sheets the envelope takes
    capacity_mm          DECIMAL(6, 2)      NULL,   -- envelope capacity (thickness) in mm
    legacy_id            UNIQUEIDENTIFIER   NULL,
    description          NVARCHAR(300)      NOT NULL,
    is_envelope          BIT                NOT NULL CONSTRAINT df_stock_env DEFAULT (0),
    is_insert            BIT                NOT NULL CONSTRAINT df_stock_ins DEFAULT (0),
    envelope_size_id     INT                NULL CONSTRAINT fk_stock_envsize REFERENCES idoc.envelope_size (envelope_size_id),
    weight_g             DECIMAL(8, 2)      NOT NULL CONSTRAINT df_stock_wt DEFAULT (0),
    thickness_mm         DECIMAL(6, 2)      NOT NULL CONSTRAINT df_stock_th DEFAULT (0),
    width_mm             DECIMAL(7, 2)      NULL,
    height_mm            DECIMAL(7, 2)      NULL,
    window_width_mm      DECIMAL(7, 2)      NULL,
    window_height_mm     DECIMAL(7, 2)      NULL,
    is_stock_managed     BIT                NOT NULL CONSTRAINT df_stock_managed DEFAULT (0),
    is_active            BIT                NOT NULL CONSTRAINT df_stock_active DEFAULT (1),
    -- 'WH' codes are warehouse-managed stock; other codes are provisional until stock management assigns one
    is_warehouse_code    AS (CAST(CASE WHEN stock_code LIKE N'WH%' THEN 1 ELSE 0 END AS BIT)) PERSISTED
);
GO
CREATE UNIQUE INDEX uq_stock_code ON idoc.stock_item (stock_code) WHERE stock_code IS NOT NULL;
CREATE UNIQUE INDEX ux_stock_legacy ON idoc.stock_item (legacy_id) WHERE legacy_id IS NOT NULL;
GO

-- Customer envelope configuration (FileMaker 'Envelopes', replaces envelopesJSON).
-- Lookup: account + brand + delivery band + postal rate (which fixes format, service and weight band) -> outer envelope.
CREATE TABLE idoc.account_envelope (
    account_envelope_id INT IDENTITY(1, 1) NOT NULL CONSTRAINT pk_account_envelope PRIMARY KEY,
    account_id          INT                NOT NULL CONSTRAINT fk_ae_account REFERENCES idoc.account (account_id),
    brand_id            INT                NULL CONSTRAINT fk_ae_brand REFERENCES idoc.brand (brand_id),
    delivery_band       NVARCHAR(50)       NOT NULL,   -- customer-facing service, e.g. '1st Class'
    postal_rate_id      INT                NOT NULL CONSTRAINT fk_ae_rate REFERENCES idoc.postal_rate (postal_rate_id),
    outer_stock_item_id INT                NOT NULL CONSTRAINT fk_ae_stock REFERENCES idoc.stock_item (stock_item_id),
    external_name       NVARCHAR(200)      NULL,
    reference           NVARCHAR(100)      NULL,
    is_oversticker      BIT                NOT NULL CONSTRAINT df_ae_overs DEFAULT (0),
    is_deleted          BIT                NOT NULL CONSTRAINT df_ae_deleted DEFAULT (0),
    legacy_id           UNIQUEIDENTIFIER   NULL
);
GO
CREATE UNIQUE INDEX ux_account_envelope_legacy ON idoc.account_envelope (legacy_id) WHERE legacy_id IS NOT NULL;
GO
CREATE UNIQUE INDEX ux_account_envelope_lookup
    ON idoc.account_envelope (account_id, brand_id, delivery_band, postal_rate_id, reference)
    WHERE is_deleted = 0;
GO

/* ===========================================================================
   4. INGEST: JOB, SOURCE, ADDRESS, OPTIONS
   =========================================================================== */
CREATE TABLE idoc.job (
    job_id        BIGINT IDENTITY(1, 1) NOT NULL CONSTRAINT pk_job PRIMARY KEY,
    account_id    INT                   NOT NULL CONSTRAINT fk_job_account REFERENCES idoc.account (account_id), -- grouping account
    base_name     NVARCHAR(260)         NOT NULL,   -- shared file stem of the .xml / .pdf pair
    xml_file_name NVARCHAR(260)         NOT NULL,
    pdf_file_name NVARCHAR(260)         NOT NULL,
    export_date   DATETIME2(0)          NOT NULL,   -- ingest time (FileMaker stamps this in the XSLT)
    status        NVARCHAR(30)          NOT NULL CONSTRAINT df_job_status DEFAULT (N'Received'),
    pack_count    INT                   NULL,
    page_count    INT                   NULL,
    CONSTRAINT uq_job_base UNIQUE (account_id, base_name)
);
GO

CREATE TABLE idoc.source (
    source_id     BIGINT IDENTITY(1, 1) NOT NULL CONSTRAINT pk_source PRIMARY KEY,
    source_guid   UNIQUEIDENTIFIER      NOT NULL,
    owner_account NVARCHAR(100)         NOT NULL,
    owner_user    NVARCHAR(300)         NOT NULL,
    CONSTRAINT uq_source_guid UNIQUE (source_guid)
);
GO

/* One row per distinct printed addressee + address (FileMaker normalisation: upper case, spaces,
   hyphens, dots, commas and apostrophes removed, '&' = 'AND'). The addressee line(s) are INCLUDED,
   so two different people at one address never share an address row. */
CREATE TABLE idoc.address (
    address_id   BIGINT IDENTITY(1, 1) NOT NULL CONSTRAINT pk_address PRIMARY KEY,
    address_hash CHAR(64)              NOT NULL,   -- SHA-256 of normalised lines (excluding the trailing postcode line)
    postcode     NVARCHAR(12)          NOT NULL,
    country_code NCHAR(2)              NULL,
    first_used   DATETIME2(0)          NOT NULL CONSTRAINT df_address_first DEFAULT (SYSUTCDATETIME()),
    last_used    DATETIME2(0)          NOT NULL CONSTRAINT df_address_last DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT uq_address_hash UNIQUE (address_hash)
);
GO

CREATE TABLE idoc.address_line (
    address_id BIGINT        NOT NULL CONSTRAINT fk_address_line_address REFERENCES idoc.address (address_id),
    line_no    TINYINT       NOT NULL,
    text       NVARCHAR(200) NOT NULL,
    CONSTRAINT pk_address_line PRIMARY KEY (address_id, line_no)
);
GO

-- Distinct combinations of print/delivery options seen in the XML (3 in the Fexco sample).
CREATE TABLE idoc.option_set (
    option_set_id    INT IDENTITY(1, 1) NOT NULL CONSTRAINT pk_option_set PRIMARY KEY,
    colour           NVARCHAR(30)       NOT NULL,
    delivery_method  NVARCHAR(50)       NOT NULL,   -- '1st Class' / '2nd Class' (customer's requested service)
    delivery_band    NVARCHAR(100)      NOT NULL,   -- 'Letter (Up to 100g)' as requested
    envelope_value   NVARCHAR(200)      NOT NULL,   -- as requested; advisory only - the envelope is derived
    envelope_code    NVARCHAR(50)       NULL,
    is_duplex        BIT                NOT NULL,
    paper_id         INT                NOT NULL CONSTRAINT fk_option_set_paper REFERENCES idoc.paper (paper_id),
    CONSTRAINT uq_option_set UNIQUE (colour, delivery_method, delivery_band, envelope_value, envelope_code, is_duplex, paper_id)
);
GO

CREATE TABLE idoc.passthrough_value (
    passthrough_value_id BIGINT IDENTITY(1, 1) NOT NULL CONSTRAINT pk_passthrough_value PRIMARY KEY,
    value                NVARCHAR(400)         NOT NULL,
    CONSTRAINT uq_passthrough_value UNIQUE (value)
);
GO

/* ===========================================================================
   5. BATCH AND MAILPIECE
   =========================================================================== */
/* A batch = all mailpieces in ONE job that share the same production identity.
   Batches are never combined across different envelopes, brands etc. to reach the machine threshold. */
/* One global running number for batch codes (FileMaker: Settings::batchCode). Start it at FileMaker's current value:
   ALTER SEQUENCE idoc.batch_code_seq RESTART WITH <next number>; */
CREATE SEQUENCE idoc.batch_code_seq AS BIGINT START WITH 1 INCREMENT BY 1 NO CYCLE;
GO
CREATE TABLE idoc.batch (
    batch_id                BIGINT IDENTITY(1, 1) NOT NULL CONSTRAINT pk_batch PRIMARY KEY,
    job_id                  BIGINT                NOT NULL CONSTRAINT fk_batch_job REFERENCES idoc.job (job_id),
    account_id              INT                   NOT NULL CONSTRAINT fk_batch_account REFERENCES idoc.account (account_id),
    brand_id                INT                   NULL CONSTRAINT fk_batch_brand REFERENCES idoc.brand (brand_id),
    outer_stock_item_id     INT                   NOT NULL CONSTRAINT fk_batch_envelope REFERENCES idoc.stock_item (stock_item_id),
    postal_service_id       INT                   NOT NULL CONSTRAINT fk_batch_service REFERENCES idoc.postal_service (postal_service_id),
    postal_format_id        INT                   NOT NULL CONSTRAINT fk_batch_format REFERENCES idoc.postal_format (postal_format_id),
    paper_id                INT                   NOT NULL CONSTRAINT fk_batch_paper REFERENCES idoc.paper (paper_id),
    batching_value          NVARCHAR(400)         NOT NULL CONSTRAINT df_batch_bval DEFAULT (N''), -- customer match key, e.g. tenant / property id
    enclosing_route         NVARCHAR(20)          NOT NULL,   -- RECEPTION | MACHINE_CANDIDATE | HAND  (part of the key)
    insert_set_hash         CHAR(64)              NOT NULL,   -- SHA-256 of the SORTED stock item ids ('NO INSERTS' when empty)
    batch_key               CHAR(64)              NOT NULL,   -- SHA-256 of all of the above, canonical form
    fulfilment_department   NVARCHAR(30)          NOT NULL,   -- Reception | Machine enclosing | Hand enclosing (set after counting)
    mailpiece_count         INT                   NOT NULL CONSTRAINT df_batch_count DEFAULT (0),
    batch_code              BIGINT                NOT NULL CONSTRAINT df_batch_code DEFAULT (NEXT VALUE FOR idoc.batch_code_seq), -- print file / run sheet name
    current_status          NVARCHAR(30)          NOT NULL CONSTRAINT df_batch_status DEFAULT (N'Created'),
    created_at              DATETIME2(0)          NOT NULL CONSTRAINT df_batch_created DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT uq_batch_key UNIQUE (job_id, batch_key),
    CONSTRAINT uq_batch_code UNIQUE (batch_code),
    CONSTRAINT ck_batch_route CHECK (enclosing_route IN (N'RECEPTION', N'MACHINE_CANDIDATE', N'HAND')),
    CONSTRAINT ck_batch_department CHECK (fulfilment_department IN (N'Reception', N'Machine enclosing', N'Hand enclosing')),
    -- Only a MACHINE_CANDIDATE batch can ever be machine enclosed; the count threshold is checked in v_rule_violations
    CONSTRAINT ck_batch_machine_route CHECK (fulfilment_department <> N'Machine enclosing' OR enclosing_route = N'MACHINE_CANDIDATE'),
    CONSTRAINT ck_batch_reception_route CHECK (
        (enclosing_route = N'RECEPTION' AND fulfilment_department = N'Reception')
        OR (enclosing_route <> N'RECEPTION' AND fulfilment_department <> N'Reception')
    )
);
GO

CREATE TABLE idoc.batch_insert (
    batch_id      BIGINT NOT NULL CONSTRAINT fk_batch_insert_batch REFERENCES idoc.batch (batch_id),
    stock_item_id INT    NOT NULL CONSTRAINT fk_batch_insert_stock REFERENCES idoc.stock_item (stock_item_id),
    quantity      INT    NOT NULL CONSTRAINT df_batch_insert_qty DEFAULT (1),
    CONSTRAINT pk_batch_insert PRIMARY KEY (batch_id, stock_item_id)
);
GO

CREATE TABLE idoc.mailpiece (
    mailpiece_id         BIGINT IDENTITY(1, 1) NOT NULL CONSTRAINT pk_mailpiece PRIMARY KEY,
    job_id               BIGINT                NOT NULL CONSTRAINT fk_mp_job REFERENCES idoc.job (job_id),
    account_id           INT                   NOT NULL CONSTRAINT fk_mp_account REFERENCES idoc.account (account_id),
    address_id           BIGINT                NOT NULL CONSTRAINT fk_mp_address REFERENCES idoc.address (address_id),
    batch_id             BIGINT                NULL CONSTRAINT fk_mp_batch REFERENCES idoc.batch (batch_id),
    brand_id             INT                   NULL CONSTRAINT fk_mp_brand REFERENCES idoc.brand (brand_id),
    account_envelope_id  INT                   NULL CONSTRAINT fk_mp_envelope REFERENCES idoc.account_envelope (account_envelope_id),
    postal_format_id     INT                   NULL CONSTRAINT fk_mp_format REFERENCES idoc.postal_format (postal_format_id),
    postal_rate_id       INT                   NULL CONSTRAINT fk_mp_rate REFERENCES idoc.postal_rate (postal_rate_id),
    delivery_band        NVARCHAR(50)          NULL,   -- best (first alphabetically) of the merged packs' requested services
    pack_count           INT                   NOT NULL,
    page_count           INT                   NOT NULL,
    sheet_count          INT                   NOT NULL,
    -- Physical derivation (see design notes): sheets x a4_sheet_weight_g + inserts + outer envelope
    weight_g             INT                   NULL,
    thickness_mm         DECIMAL(6, 2)         NULL,
    enclosing_route      NVARCHAR(20)          NULL,
    match_key            CHAR(64)              NULL,   -- job + recipient + configured passthrough values
    is_enclosed          BIT                   NOT NULL CONSTRAINT df_mp_enclosed DEFAULT (0),
    is_cancelled         BIT                   NOT NULL CONSTRAINT df_mp_cancelled DEFAULT (0),
    created_at           DATETIME2(0)          NOT NULL CONSTRAINT df_mp_created DEFAULT (SYSUTCDATETIME()),
    -- Target of the pack foreign key that makes a cross-recipient merge impossible
    CONSTRAINT uq_mailpiece_recipient UNIQUE (mailpiece_id, job_id, account_id, address_id),
    CONSTRAINT ck_mp_route CHECK (enclosing_route IS NULL OR enclosing_route IN (N'RECEPTION', N'MACHINE_CANDIDATE', N'HAND'))
);
GO

/* ===========================================================================
   6. PACK
   =========================================================================== */
CREATE TABLE idoc.pack (
    pack_id               BIGINT IDENTITY(1, 1) NOT NULL CONSTRAINT pk_pack PRIMARY KEY,
    pack_guid             UNIQUEIDENTIFIER      NOT NULL,   -- idempotency / duplicate key
    job_id                BIGINT                NOT NULL CONSTRAINT fk_pack_job REFERENCES idoc.job (job_id),
    account_id            INT                   NOT NULL CONSTRAINT fk_pack_account REFERENCES idoc.account (account_id),            -- grouping account
    submitting_account_id INT                   NOT NULL CONSTRAINT fk_pack_submitting REFERENCES idoc.account (account_id),
    source_id             BIGINT                NOT NULL CONSTRAINT fk_pack_source REFERENCES idoc.source (source_id),
    address_id            BIGINT                NOT NULL CONSTRAINT fk_pack_address REFERENCES idoc.address (address_id),
    option_set_id         INT                   NOT NULL CONSTRAINT fk_pack_options REFERENCES idoc.option_set (option_set_id),
    brand_id              INT                   NULL CONSTRAINT fk_pack_brand REFERENCES idoc.brand (brand_id),
    mailpiece_id          BIGINT                NULL,
    -- Best-effort recipient name from H-POD (unreliable: guessed from line 1). NEVER used for matching.
    recipient_first_name  NVARCHAR(100)         NULL,
    recipient_surname     NVARCHAR(100)         NULL,
    page_count            INT                   NOT NULL,
    start_page            INT                   NOT NULL,
    end_page              INT                   NOT NULL,
    sheet_count           INT                   NOT NULL,
    colour_pages          INT                   NULL,       -- from PDF analysis
    mono_pages            INT                   NULL,
    blank_pages           INT                   NULL,
    status                NVARCHAR(30)          NOT NULL,
    delivery_point_suffix NVARCHAR(10)          NULL,
    attachment_count      INT                   NOT NULL CONSTRAINT df_pack_attach DEFAULT (0),
    release_date          DATETIME2(0)          NOT NULL,
    document_sequence     INT                   NOT NULL CONSTRAINT df_pack_seq DEFAULT (99),   -- order inside a merged envelope; 99 = unlisted
    batching_reference    NVARCHAR(400)         NULL,
    -- Matching
    is_match_excluded     BIT                   NOT NULL CONSTRAINT df_pack_excluded DEFAULT (0), -- exclusion rule, anonymous addressee, or notice line removed
    match_exclusion_reason NVARCHAR(50)         NULL,
    match_key             CHAR(64)              NOT NULL,   -- SHA-256: job + normalised addressee/address + configured passthrough values; unique per pack when excluded
    created_at            DATETIME2(0)          NOT NULL CONSTRAINT df_pack_created DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT uq_pack_guid UNIQUE (pack_guid),
    CONSTRAINT ck_pack_pages CHECK (end_page >= start_page AND page_count = end_page - start_page + 1),
    CONSTRAINT ck_pack_excluded_reason CHECK (is_match_excluded = 0 OR match_exclusion_reason IS NOT NULL),
    /* RULE 1 (GDPR): a pack can only belong to a mailpiece that has the SAME job, account AND address row.
       The address row includes the addressee lines, so two different recipients can never share an envelope. */
    CONSTRAINT fk_pack_mailpiece_same_recipient FOREIGN KEY (mailpiece_id, job_id, account_id, address_id)
        REFERENCES idoc.mailpiece (mailpiece_id, job_id, account_id, address_id)
);
GO
CREATE INDEX ix_pack_job ON idoc.pack (job_id, start_page);
CREATE INDEX ix_pack_mailpiece ON idoc.pack (mailpiece_id);
CREATE INDEX ix_pack_match ON idoc.pack (job_id, match_key) INCLUDE (document_sequence);
CREATE INDEX ix_pack_address ON idoc.pack (address_id);
-- An excluded pack may never share an envelope with another excluded pack
CREATE UNIQUE INDEX ux_pack_excluded_alone ON idoc.pack (mailpiece_id)
    WHERE is_match_excluded = 1 AND mailpiece_id IS NOT NULL;
GO

CREATE TABLE idoc.pack_passthrough (
    pack_id              BIGINT NOT NULL CONSTRAINT fk_pp_pack REFERENCES idoc.pack (pack_id),
    passthrough_key_id   INT    NOT NULL CONSTRAINT fk_pp_key REFERENCES idoc.passthrough_key (passthrough_key_id),
    passthrough_value_id BIGINT NOT NULL CONSTRAINT fk_pp_value REFERENCES idoc.passthrough_value (passthrough_value_id),
    CONSTRAINT pk_pack_passthrough PRIMARY KEY (pack_id, passthrough_key_id)
);
GO
CREATE INDEX ix_pack_passthrough_value ON idoc.pack_passthrough (passthrough_key_id, passthrough_value_id) INCLUDE (pack_id);
GO

CREATE TABLE idoc.pack_identifier (
    pack_id            BIGINT        NOT NULL CONSTRAINT fk_pi_pack REFERENCES idoc.pack (pack_id),
    identifier_type_id INT           NOT NULL CONSTRAINT fk_pi_type REFERENCES idoc.identifier_type (identifier_type_id),
    value              NVARCHAR(200) NOT NULL,
    CONSTRAINT pk_pack_identifier PRIMARY KEY (pack_id, identifier_type_id, value)
);
GO
CREATE INDEX ix_pack_identifier_value ON idoc.pack_identifier (identifier_type_id, value);
GO

CREATE TABLE idoc.pack_insert (
    pack_id          BIGINT       NOT NULL CONSTRAINT fk_pins_pack REFERENCES idoc.pack (pack_id),
    stock_item_id    INT          NOT NULL CONSTRAINT fk_pins_stock REFERENCES idoc.stock_item (stock_item_id),
    quantity         INT          NOT NULL CONSTRAINT df_pins_qty DEFAULT (1),
    publication_date NVARCHAR(30) NULL,   -- XML Insert@PublicationDate (discarded by FileMaker; kept here)
    CONSTRAINT pk_pack_insert PRIMARY KEY (pack_id, stock_item_id)
);
GO

/* ===========================================================================
   7. VIEWS
   =========================================================================== */
-- Inserts physically in a mailpiece = union of its packs' inserts, plus linked child stock items.
CREATE VIEW idoc.v_mailpiece_insert AS
SELECT u.mailpiece_id,
       u.stock_item_id,
       SUM(u.quantity) AS quantity
FROM (
    -- the inserts named in the XML
    SELECT p.mailpiece_id, pi.stock_item_id, pi.quantity
    FROM idoc.pack AS p
    INNER JOIN idoc.pack_insert AS pi ON pi.pack_id = p.pack_id
    WHERE p.mailpiece_id IS NOT NULL
    UNION ALL
    -- plus the stock items linked to them (FileMaker 'Linked Stock Codes'), resolved at query time
    SELECT p.mailpiece_id, c.stock_item_id, pi.quantity
    FROM idoc.pack AS p
    INNER JOIN idoc.pack_insert AS pi ON pi.pack_id = p.pack_id
    INNER JOIN idoc.stock_item AS c ON c.parent_stock_item_id = pi.stock_item_id
    WHERE p.mailpiece_id IS NOT NULL
) AS u
GROUP BY u.mailpiece_id, u.stock_item_id;
GO

-- Audit view: any row returned is a business-rule breach that must be investigated.
CREATE VIEW idoc.v_rule_violations AS
-- Rule 1: more than one distinct recipient in one mailpiece (cannot occur while the FK exists - belt and braces)
SELECT N'MULTIPLE_RECIPIENTS_IN_ENVELOPE' AS rule_name, CAST(p.mailpiece_id AS BIGINT) AS entity_id
FROM idoc.pack AS p
WHERE p.mailpiece_id IS NOT NULL
GROUP BY p.mailpiece_id
HAVING COUNT(DISTINCT p.address_id) > 1
UNION ALL
-- Excluded pack merged with any other pack
SELECT N'EXCLUDED_PACK_MERGED', p.mailpiece_id
FROM idoc.pack AS p
WHERE p.is_match_excluded = 1 AND p.mailpiece_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM idoc.pack AS o WHERE o.mailpiece_id = p.mailpiece_id AND o.pack_id <> p.pack_id)
UNION ALL
-- Machine enclosing needs MORE than the minimum number of mailpieces in the same batch AND the C5 envelope
SELECT N'MACHINE_ENCLOSING_RULE', b.batch_id
FROM idoc.batch AS b
CROSS JOIN idoc.settings AS s
INNER JOIN idoc.stock_item AS e ON e.stock_item_id = b.outer_stock_item_id
INNER JOIN idoc.envelope_size AS z ON z.envelope_size_id = e.envelope_size_id
WHERE b.fulfilment_department = N'Machine enclosing'
  AND (b.mailpiece_count <= s.machine_enclosing_min_mailpieces OR z.code <> s.machine_enclosing_envelope_code)
UNION ALL
-- Every mailpiece in a batch must match the batch's envelope, brand and paper inputs
SELECT N'MAILPIECE_BATCH_MISMATCH', m.mailpiece_id
FROM idoc.mailpiece AS m
INNER JOIN idoc.batch AS b ON b.batch_id = m.batch_id
INNER JOIN idoc.account_envelope AS ae ON ae.account_envelope_id = m.account_envelope_id
WHERE ae.outer_stock_item_id <> b.outer_stock_item_id
   OR COALESCE(m.brand_id, 0) <> COALESCE(b.brand_id, 0)
   OR m.job_id <> b.job_id;
GO

/* ===========================================================================
   8. SEED DATA
   =========================================================================== */
INSERT INTO idoc.settings (settings_id) VALUES (1);

INSERT INTO idoc.postal_format (name, rank_order, max_weight_g, max_thickness_mm, max_sheets) VALUES
    (N'Letter',        1,  100,  5.00,   16),
    (N'Large Letter',  2,  750, 25.00,  125),
    (N'Small Parcel',  3, 2000,  NULL,  NULL),
    (N'Medium Parcel', 4, 20000, NULL,  NULL);   -- CONFIRM limits against Royal Mail / carrier rules

-- CONFIRM list with production before go-live
INSERT INTO idoc.anonymous_addressee (normalised_text) VALUES
    (N'THEOCCUPIER'), (N'THERESIDENT'), (N'THEOWNER'), (N'THEHOMEOWNER'), (N'THEHOUSEHOLDER'), (N'THETENANT');
GO

/* ===========================================================================
   9. REQUESTED vs ACTUAL
   The XML settings (service, delivery band, envelope text and code) are kept as received on idoc.option_set; the mailpiece
   holds what was actually chosen from the real weight. This view lines them up and flags every difference.
   =========================================================================== */
GO
CREATE VIEW idoc.v_pack_requested_vs_actual AS
SELECT p.pack_id, p.pack_guid, p.job_id, p.mailpiece_id,
       os.delivery_method                 AS requested_service,
       os.delivery_band                   AS requested_band,
       CASE WHEN CHARINDEX(N' (', os.delivery_band) > 0 THEN LEFT(os.delivery_band, CHARINDEX(N' (', os.delivery_band) - 1) ELSE os.delivery_band END AS requested_format,
       os.envelope_value                  AS requested_envelope_text,
       os.envelope_code                   AS requested_envelope_code,
       pf.name                            AS actual_format,
       si.stock_code                      AS actual_envelope_code,
       es.code                            AS actual_envelope_size,
       m.weight_g                         AS actual_weight_g,
       m.enclosing_route                  AS actual_route,
       CAST(CASE WHEN pf.name <> CASE WHEN CHARINDEX(N' (', os.delivery_band) > 0 THEN LEFT(os.delivery_band, CHARINDEX(N' (', os.delivery_band) - 1) ELSE os.delivery_band END
                 THEN 1 ELSE 0 END AS BIT) AS format_changed,
       CAST(CASE WHEN si.stock_code <> os.envelope_code THEN 1 ELSE 0 END AS BIT) AS envelope_changed
FROM idoc.pack AS p
INNER JOIN idoc.option_set AS os ON os.option_set_id = p.option_set_id
LEFT JOIN idoc.mailpiece AS m ON m.mailpiece_id = p.mailpiece_id
LEFT JOIN idoc.postal_format AS pf ON pf.postal_format_id = m.postal_format_id
LEFT JOIN idoc.account_envelope AS ae ON ae.account_envelope_id = m.account_envelope_id
LEFT JOIN idoc.stock_item AS si ON si.stock_item_id = ae.outer_stock_item_id
LEFT JOIN idoc.envelope_size AS es ON es.envelope_size_id = si.envelope_size_id;
GO
