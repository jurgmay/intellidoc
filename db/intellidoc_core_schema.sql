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
    small_batch_limit                   INT           NOT NULL CONSTRAINT df_settings_small_batch DEFAULT (20),   -- a batch of fewer mailpieces than this carries the small batch adjustment (pricing)
    -- XML-first import (the watcher reads these every minute, so a change applies without a restart)
    xml_first_enabled                   BIT           NOT NULL CONSTRAINT df_settings_xml_first DEFAULT (1),   -- import an XML without waiting for its PDF
    pdf_wait_minutes                    INT           NOT NULL CONSTRAINT df_settings_pdf_wait DEFAULT (30),   -- first "PDF missing" alert after this long
    pdf_reminder_minutes                INT           NOT NULL CONSTRAINT df_settings_pdf_remind DEFAULT (30), -- then a reminder this often
    alert_recipients                    NVARCHAR(1000) NOT NULL CONSTRAINT df_settings_alert_to DEFAULT (N''), -- e-mail addresses, comma or semicolon separated
    email_run_sheets                    BIT           NOT NULL CONSTRAINT df_settings_email_rs DEFAULT (0),                    -- e-mail a job's run sheets when its print files are first made
    run_sheet_recipients                NVARCHAR(1000) NOT NULL CONSTRAINT df_settings_rs_to DEFAULT (N''),      -- the first is the To, the rest are Cc (the customer's notification addresses are added to Cc)
    -- PDF composition (the print files). The marks are measured in millimetres from the top left of the trim box, the way FileMaker did it.
    -- The first-time values are placeholders: set them to the press / enclosing machine's real positions on the Settings page.
    auto_compose                        BIT           NOT NULL CONSTRAINT df_settings_auto_compose DEFAULT (0),               -- the watcher makes the print files itself when a job is Received (needs COMPOSE_OUT_DIR)
    max_pages_per_pdf                   INT           NOT NULL CONSTRAINT df_settings_max_pages DEFAULT (10000), -- a print file is closed after the mailpiece that takes it past this
    mark_seq_font_pt                    DECIMAL(6, 3) NOT NULL CONSTRAINT df_settings_seq_font DEFAULT (8),      -- the window sequence number, e.g. 1042/000123 (OCR-B)
    mark_seq_left_mm                    DECIMAL(7, 3) NOT NULL CONSTRAINT df_settings_seq_left DEFAULT (20),
    mark_seq_top_mm                     DECIMAL(7, 3) NOT NULL CONSTRAINT df_settings_seq_top DEFAULT (40),
    mark_seq_width_mm                   DECIMAL(7, 3) NOT NULL CONSTRAINT df_settings_seq_width DEFAULT (45),
    mark_seq_height_mm                  DECIMAL(7, 3) NOT NULL CONSTRAINT df_settings_seq_height DEFAULT (4),
    mark_dm_left_mm                     DECIMAL(7, 3) NOT NULL CONSTRAINT df_settings_dm_left DEFAULT (20),      -- the window Data Matrix
    mark_dm_top_mm                      DECIMAL(7, 3) NOT NULL CONSTRAINT df_settings_dm_top DEFAULT (30),
    mark_dm_width_mm                    DECIMAL(7, 3) NOT NULL CONSTRAINT df_settings_dm_width DEFAULT (8),
    mark_dm_height_mm                   DECIMAL(7, 3) NOT NULL CONSTRAINT df_settings_dm_height DEFAULT (8),
    mark_dot_x_mm                       DECIMAL(7, 3) NOT NULL CONSTRAINT df_settings_dot_x DEFAULT (205.5),     -- the pack start dot (centre); FileMaker's fixed position
    mark_dot_y_mm                       DECIMAL(7, 3) NOT NULL CONSTRAINT df_settings_dot_y DEFAULT (269),
    mark_dot_diameter_mm                DECIMAL(7, 3) NOT NULL CONSTRAINT df_settings_dot_d DEFAULT (2),
    -- The page the marks are measured on (A4 unless the work changes): the size of blank pages the composer adds, and of the marks preview.
    activity_keep_days                  INT           NOT NULL CONSTRAINT df_settings_act_days DEFAULT (7),     -- finished Activity rows are deleted after this many days (the watcher tidies hourly)
    activity_rows_shown                 INT           NOT NULL CONSTRAINT df_settings_act_rows DEFAULT (30),   -- how many finished tasks the Activity screen lists
    page_width_mm                       DECIMAL(7, 3) NOT NULL CONSTRAINT df_settings_page_width DEFAULT (210),
    page_height_mm                      DECIMAL(7, 3) NOT NULL CONSTRAINT df_settings_page_height DEFAULT (297),
    -- The address window of the envelope, as it lies over the letter (same units). Only the marks preview draws it; the print files do not use it.
    window_left_mm                      DECIMAL(7, 3) NOT NULL CONSTRAINT df_settings_win_left DEFAULT (15),
    window_top_mm                       DECIMAL(7, 3) NOT NULL CONSTRAINT df_settings_win_top DEFAULT (25),
    window_width_mm                     DECIMAL(7, 3) NOT NULL CONSTRAINT df_settings_win_width DEFAULT (90),
    window_height_mm                    DECIMAL(7, 3) NOT NULL CONSTRAINT df_settings_win_height DEFAULT (35),
    -- MRDF page codes (customers that use MRDF): on the front of every sheet, in the same units. Placeholders until set from a printed proof.
    mrdf_dm_left_mm                     DECIMAL(7, 3) NOT NULL CONSTRAINT df_settings_mrdf_dm_left DEFAULT (10),
    mrdf_dm_top_mm                      DECIMAL(7, 3) NOT NULL CONSTRAINT df_settings_mrdf_dm_top DEFAULT (10),
    mrdf_dm_width_mm                    DECIMAL(7, 3) NOT NULL CONSTRAINT df_settings_mrdf_dm_width DEFAULT (8),
    mrdf_dm_height_mm                   DECIMAL(7, 3) NOT NULL CONSTRAINT df_settings_mrdf_dm_height DEFAULT (8),
    mrdf_ocr_font_pt                    DECIMAL(6, 3) NOT NULL CONSTRAINT df_settings_mrdf_ocr_font DEFAULT (8.2),
    mrdf_ocr_left_mm                    DECIMAL(7, 3) NOT NULL CONSTRAINT df_settings_mrdf_ocr_left DEFAULT (20),
    mrdf_ocr_top_mm                     DECIMAL(7, 3) NOT NULL CONSTRAINT df_settings_mrdf_ocr_top DEFAULT (10),
    mrdf_ocr_width_mm                   DECIMAL(7, 3) NOT NULL CONSTRAINT df_settings_mrdf_ocr_width DEFAULT (30),
    mrdf_ocr_height_mm                  DECIMAL(7, 3) NOT NULL CONSTRAINT df_settings_mrdf_ocr_height DEFAULT (4),
    mrdf_ocr_rotation_deg               INT           NOT NULL CONSTRAINT df_settings_mrdf_ocr_rot DEFAULT (0),  -- clockwise about the centre of the OCR box: 0, 90, 180 or 270
    -- Network (Settings > Network). Stored for the apps that need them; the password is encrypted by the API (never plain text here).
    network_username                    NVARCHAR(500) NOT NULL CONSTRAINT df_settings_net_user DEFAULT (N''),
    network_password                    NVARCHAR(1000) NOT NULL CONSTRAINT df_settings_net_pass DEFAULT (N''),
    workflow_network_path               NVARCHAR(500) NOT NULL CONSTRAINT df_settings_wf_path DEFAULT (N''),
    workflow_shared_folder              NVARCHAR(500) NOT NULL CONSTRAINT df_settings_wf_share DEFAULT (N''),
    folder_in                           NVARCHAR(500) NOT NULL CONSTRAINT df_settings_f_in DEFAULT (N''),
    folder_out                          NVARCHAR(500) NOT NULL CONSTRAINT df_settings_f_out DEFAULT (N''),
    folder_hold                         NVARCHAR(500) NOT NULL CONSTRAINT df_settings_f_hold DEFAULT (N''),
    folder_print_files                  NVARCHAR(500) NOT NULL CONSTRAINT df_settings_f_print DEFAULT (N''),
    folder_processed                    NVARCHAR(500) NOT NULL CONSTRAINT df_settings_f_proc DEFAULT (N''),
    bluecrest_network_path              NVARCHAR(500) NOT NULL CONSTRAINT df_settings_bc_path DEFAULT (N''),
    bluecrest_input_folder              NVARCHAR(500) NOT NULL CONSTRAINT df_settings_bc_in DEFAULT (N''),
    bluecrest_output_folder             NVARCHAR(500) NOT NULL CONSTRAINT df_settings_bc_out DEFAULT (N''),
    bluecrest_lock_folder               NVARCHAR(500) NOT NULL CONSTRAINT df_settings_bc_lock DEFAULT (N''),
    bluecrest_select_folder             NVARCHAR(500) NOT NULL CONSTRAINT df_settings_bc_sel DEFAULT (N''),
    bluecrest_archive_name              NVARCHAR(500) NOT NULL CONSTRAINT df_settings_bc_arch DEFAULT (N''),
    dockets_folder                      NVARCHAR(500) NOT NULL CONSTRAINT df_settings_dockets DEFAULT (N''),
    dockets_signed_for_folder           NVARCHAR(500) NOT NULL CONSTRAINT df_settings_signed DEFAULT (N''),
    -- Connectivity (Settings > Connectivity). The passwords are encrypted by the API (never plain text here). Nothing reads these yet except the test buttons.
    email_enabled                       BIT           NOT NULL CONSTRAINT df_settings_email_on DEFAULT (0),
    smtp_from_name                      NVARCHAR(500) NOT NULL CONSTRAINT df_settings_smtp_fname DEFAULT (N''),
    smtp_from_address                   NVARCHAR(500) NOT NULL CONSTRAINT df_settings_smtp_faddr DEFAULT (N''),
    smtp_reply_to                       NVARCHAR(500) NOT NULL CONSTRAINT df_settings_smtp_reply DEFAULT (N''),
    smtp_server                         NVARCHAR(500) NOT NULL CONSTRAINT df_settings_smtp_server DEFAULT (N''),
    smtp_port                           INT           NOT NULL CONSTRAINT df_settings_smtp_port DEFAULT (587),
    smtp_username                       NVARCHAR(500) NOT NULL CONSTRAINT df_settings_smtp_user DEFAULT (N''),
    smtp_password                       NVARCHAR(1000) NOT NULL CONSTRAINT df_settings_smtp_pass DEFAULT (N''),
    hpod_endpoint                       NVARCHAR(500) NOT NULL CONSTRAINT df_settings_hpod_end DEFAULT (N''),
    hpod_instance                       NVARCHAR(500) NOT NULL CONSTRAINT df_settings_hpod_inst DEFAULT (N''),
    hpod_account_code                   NVARCHAR(500) NOT NULL CONSTRAINT df_settings_hpod_acct DEFAULT (N''),
    hpod_username                       NVARCHAR(500) NOT NULL CONSTRAINT df_settings_hpod_user DEFAULT (N''),
    hpod_password                       NVARCHAR(1000) NOT NULL CONSTRAINT df_settings_hpod_pass DEFAULT (N''),
    CONSTRAINT ck_settings_smtp_port CHECK (smtp_port BETWEEN 1 AND 65535),
    CONSTRAINT ck_settings_single_row CHECK (settings_id = 1),
    CONSTRAINT ck_settings_mrdf_rot CHECK (mrdf_ocr_rotation_deg IN (0, 90, 180, 270)),
    CONSTRAINT ck_settings_mrdf CHECK (mrdf_dm_width_mm > 0 AND mrdf_dm_height_mm > 0 AND mrdf_ocr_font_pt > 0 AND mrdf_ocr_width_mm > 0 AND mrdf_ocr_height_mm > 0
        AND mrdf_dm_left_mm >= 0 AND mrdf_dm_top_mm >= 0 AND mrdf_ocr_left_mm >= 0 AND mrdf_ocr_top_mm >= 0),
    CONSTRAINT ck_settings_marks CHECK (max_pages_per_pdf >= 2 AND mark_seq_font_pt > 0 AND mark_seq_width_mm > 0 AND mark_seq_height_mm > 0
        AND mark_dm_width_mm > 0 AND mark_dm_height_mm > 0 AND mark_dot_diameter_mm > 0
        AND mark_seq_left_mm >= 0 AND mark_seq_top_mm >= 0 AND mark_dm_left_mm >= 0 AND mark_dm_top_mm >= 0 AND mark_dot_x_mm >= 0 AND mark_dot_y_mm >= 0
        AND page_width_mm > 0 AND page_height_mm > 0 AND window_width_mm > 0 AND window_height_mm > 0 AND window_left_mm >= 0 AND window_top_mm >= 0),
    CONSTRAINT ck_settings_positive CHECK (a4_sheet_weight_g > 0 AND a4_sheet_thickness_mm > 0 AND machine_enclosing_min_mailpieces >= 0
        AND machine_enclosing_max_sheets > 0 AND hand_enclosing_max_sheets > 0 AND small_batch_limit >= 0 AND pdf_wait_minutes >= 1 AND pdf_reminder_minutes >= 1
        AND activity_keep_days BETWEEN 1 AND 365 AND activity_rows_shown BETWEEN 10 AND 500)
);
GO

/* Every change made to settings from the web app: who, when, what it was and what it became. */
CREATE TABLE idoc.settings_audit (
    audit_id     BIGINT IDENTITY(1, 1) NOT NULL CONSTRAINT pk_settings_audit PRIMARY KEY,
    changed_at   DATETIME2(0)   NOT NULL CONSTRAINT df_settings_audit_at DEFAULT (SYSUTCDATETIME()),
    changed_by   NVARCHAR(200)  NOT NULL,
    setting_name NVARCHAR(100)  NOT NULL,
    old_value    NVARCHAR(1000) NULL,
    new_value    NVARCHAR(1000) NULL
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
    max_length_mm    DECIMAL(7, 2)      NOT NULL,  -- Royal Mail length: the longer side of the mailpiece, whichever way round it is held
    max_width_mm     DECIMAL(7, 2)      NOT NULL,  -- Royal Mail width: the shorter side; never more than max_length_mm
    max_sheets       INT                NULL,      -- FileMaker proxy limits: Letter 16, Large Letter 125
    CONSTRAINT uq_postal_format_name UNIQUE (name),
    CONSTRAINT uq_postal_format_rank UNIQUE (rank_order),
    CONSTRAINT ck_postal_format_size CHECK (max_length_mm > 0 AND max_width_mm > 0 AND max_width_mm <= max_length_mm)
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

/* Changes made from the web app to customers (and, later, other records): one readable line each. */
CREATE TABLE idoc.audit_log (
    audit_id    BIGINT IDENTITY(1, 1) NOT NULL CONSTRAINT pk_audit_log PRIMARY KEY,
    changed_at  DATETIME2(0)   NOT NULL CONSTRAINT df_audit_log_at DEFAULT (SYSUTCDATETIME()),
    changed_by  NVARCHAR(200)  NOT NULL,
    entity      NVARCHAR(50)   NOT NULL,   -- 'customer'
    entity_id   BIGINT         NOT NULL,   -- e.g. the customer's account_id
    summary     NVARCHAR(1000) NOT NULL
);
GO
CREATE INDEX ix_audit_log_entity ON idoc.audit_log (entity, entity_id, audit_id);
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

-- FileMaker 'Customers': both submitting accounts (match XML OwnerAccount) and the customers that hold the settings.
-- Accounts form ONE tree through parent_account_id. An account either holds its own settings (inherits_settings = 0, a 'customer')
-- or reads them from its parent (inherits_settings = 1); idoc.v_account_owner gives the account that holds the settings for each account.
CREATE TABLE idoc.account (
    account_id                  INT IDENTITY(1, 1) NOT NULL CONSTRAINT pk_account PRIMARY KEY,
    account_code               NVARCHAR(100)      NOT NULL,
    name                       NVARCHAR(200)      NOT NULL,
    parent_account_id          INT                NULL CONSTRAINT fk_account_parent REFERENCES idoc.account (account_id),
    inherits_settings          BIT                NOT NULL CONSTRAINT df_account_inherits DEFAULT (0), -- 1 = settings come from the parent (resolved up the tree)
    -- Where this account's envelope list comes from (only for accounts that hold their own settings; an inheriting account follows its parent):
    --   OWN = its own rows only, INHERIT = the parent's effective list, EXTEND = the parent's effective list plus its own rows. See idoc.v_account_envelope_source.
    envelopes_mode             NVARCHAR(10)       NOT NULL CONSTRAINT df_account_envmode DEFAULT (N'OWN'),
    -- The same choice for the other settings groups. brands = the brand list; matching = address matching on/off, batching key and matching rules;
    -- sequence = pack sequence key and rules; emails = notification addresses. For the single values (the on/off, the keys) INHERIT takes the
    -- parent's; OWN and EXTEND keep this account's own. Lists add up under EXTEND.
    brands_mode                NVARCHAR(10)       NOT NULL CONSTRAINT df_account_brandsmode DEFAULT (N'OWN'),
    matching_mode              NVARCHAR(10)       NOT NULL CONSTRAINT df_account_matchmode DEFAULT (N'OWN'),
    sequence_mode              NVARCHAR(10)       NOT NULL CONSTRAINT df_account_seqmode DEFAULT (N'OWN'),
    emails_mode                NVARCHAR(10)       NOT NULL CONSTRAINT df_account_emailsmode DEFAULT (N'OWN'),
    -- Which costing model prices this account's mail: its own (OWN) or the nearest ancestor's (INHERIT). No EXTEND: a price list is not merged.
    costing_mode               NVARCHAR(10)       NOT NULL CONSTRAINT df_account_costingmode DEFAULT (N'OWN'),
    -- Where this account's inserts (leaflets, reply envelopes, brochures: stock_item rows with is_insert = 1) come from: OWN, INHERIT (the parent's effective list) or EXTEND (both).
    inserts_mode               NVARCHAR(10)       NOT NULL CONSTRAINT df_account_insmode DEFAULT (N'OWN'),
    -- The account that is invoiced for this account's mail and whose job number is printed on the run sheet. Must be this account or an
    -- ancestor (checked by the API and the import). NULL = the account that holds the settings. See idoc.v_account_invoicing.
    invoicing_account_id       INT                NULL CONSTRAINT fk_account_invoicing REFERENCES idoc.account (account_id),
    -- Flags (read from the settings owner at ingest)
    is_address_matching        BIT                NOT NULL CONSTRAINT df_account_match DEFAULT (0),
    is_archive_mailpieces      BIT                NOT NULL CONSTRAINT df_account_archive DEFAULT (0),
    is_create_output_files     BIT                NOT NULL CONSTRAINT df_account_output DEFAULT (0),
    is_sso                     BIT                NOT NULL CONSTRAINT df_account_sso DEFAULT (0),
    is_same_day_service        BIT                NOT NULL CONSTRAINT df_account_sameday DEFAULT (0),
    is_use_mrdf                BIT                NOT NULL CONSTRAINT df_account_mrdf DEFAULT (0),
    is_testing                 BIT                NOT NULL CONSTRAINT df_account_testing DEFAULT (0),
    is_deleted                 BIT                NOT NULL CONSTRAINT df_account_deleted DEFAULT (0),
    -- How the PDF is composed for print (see ingest/src/costing/colour.ts); pricing bills the composed pages. Held by accounts that hold their own settings.
    colour_mode                NVARCHAR(25)       NOT NULL CONSTRAINT df_account_colour DEFAULT (N'ORIGINAL'),
    mis_job_number             NVARCHAR(50)       NULL,
    -- The next job number, set in advance. On pending_job_number_from (the 1st of a month) it replaces mis_job_number and is cleared.
    pending_mis_job_number     NVARCHAR(50)       NULL,
    pending_job_number_from    DATE               NULL,
    -- Day of the month (1-28) on which a pending job number takes over. Most customers use 1; one invoices mid-month and uses 21.
    job_number_rollover_day    TINYINT            NOT NULL CONSTRAINT df_account_rollday DEFAULT (1),
    return_address             NVARCHAR(500)      NULL,
    -- Written into the PDF keywords when is_archive_mailpieces is on: archiving_customer / archiving_provider / archiving_directory (the archive system's tags)
    archive_customer_tag       NVARCHAR(100)      NULL,
    archive_provider_tag       NVARCHAR(100)      NULL,
    archive_directory_tag      NVARCHAR(100)      NULL,
    -- The logo bitmaps the inserter prints, written into the MRDF (LogoBitmapSelect1/2, 8 characters)
    logo1                      NVARCHAR(8)        NULL,
    logo2                      NVARCHAR(8)        NULL,
    -- Passthrough keys that drive sequencing and batching (replace packSequenceJSON / batchingJSON)
    pack_sequence_key_id       INT                NULL CONSTRAINT fk_account_seqkey REFERENCES idoc.passthrough_key (passthrough_key_id),
    batching_key_id            INT                NULL CONSTRAINT fk_account_batchkey REFERENCES idoc.passthrough_key (passthrough_key_id),
    created_at                 DATETIME2(0)       NOT NULL CONSTRAINT df_account_created DEFAULT (SYSUTCDATETIME()),
    legacy_id                  UNIQUEIDENTIFIER   NULL,   -- FileMaker Customers.id (reference import only)
    CONSTRAINT uq_account_code UNIQUE (account_code),
    CONSTRAINT ck_account_colour CHECK (colour_mode IN (N'ORIGINAL', N'FIRST_PACK_PAGE', N'FIRST_MAILPIECE_PAGE', N'ALL_MONO')),
    CONSTRAINT ck_account_inherits CHECK (inherits_settings = 0 OR parent_account_id IS NOT NULL),
    CONSTRAINT ck_account_envmode CHECK (envelopes_mode IN (N'OWN', N'INHERIT', N'EXTEND') AND (envelopes_mode = N'OWN' OR parent_account_id IS NOT NULL)),
    CONSTRAINT ck_account_modes CHECK (brands_mode IN (N'OWN', N'INHERIT', N'EXTEND') AND matching_mode IN (N'OWN', N'INHERIT', N'EXTEND') AND sequence_mode IN (N'OWN', N'INHERIT', N'EXTEND') AND emails_mode IN (N'OWN', N'INHERIT', N'EXTEND')
        AND (parent_account_id IS NOT NULL OR (brands_mode = N'OWN' AND matching_mode = N'OWN' AND sequence_mode = N'OWN' AND emails_mode = N'OWN'))),
    CONSTRAINT ck_account_insmode CHECK (inserts_mode IN (N'OWN', N'INHERIT', N'EXTEND') AND (inserts_mode = N'OWN' OR parent_account_id IS NOT NULL)),
    CONSTRAINT ck_account_costing CHECK (costing_mode IN (N'OWN', N'INHERIT') AND (costing_mode = N'OWN' OR parent_account_id IS NOT NULL)),
    CONSTRAINT ck_account_rollday CHECK (job_number_rollover_day BETWEEN 1 AND 28),
    CONSTRAINT ck_account_pending CHECK ((pending_mis_job_number IS NULL AND pending_job_number_from IS NULL) OR (pending_mis_job_number IS NOT NULL AND pending_job_number_from IS NOT NULL))
);
GO
CREATE UNIQUE INDEX ux_account_legacy ON idoc.account (legacy_id) WHERE legacy_id IS NOT NULL;
GO

-- For every account, the account that holds its settings: itself, or the nearest ancestor that does not inherit.
-- (The API refuses any parent change that would make a loop; a loop would stop this view at the recursion limit.)
CREATE VIEW idoc.v_account_owner AS
WITH up AS (
    SELECT account_id, account_id AS node_id, inherits_settings AS inherits, parent_account_id AS next_id FROM idoc.account
    UNION ALL
    SELECT up.account_id, p.account_id, p.inherits_settings, p.parent_account_id
    FROM up INNER JOIN idoc.account AS p ON p.account_id = up.next_id WHERE up.inherits = 1)
SELECT account_id, node_id AS owner_account_id FROM up WHERE inherits = 0;
GO

-- For every account and settings group (envelopes, brands, matching, sequence, emails, costing, inserts), the accounts whose rows make up its effective settings, nearest first
-- (depth 0 = the account itself). An inheriting account passes straight through to its parent. Otherwise OWN stops here, INHERIT contributes nothing and
-- goes up, EXTEND contributes and goes up. The single values of a group (address matching, the keys) come from the nearest source.
CREATE VIEW idoc.v_account_setting_source AS
WITH node AS (
    SELECT a.account_id, a.parent_account_id, g.setting,
           CASE WHEN a.inherits_settings = 0 AND m.setting_mode <> N'INHERIT' THEN 1 ELSE 0 END AS adds_self,
           CASE WHEN a.inherits_settings = 1 OR m.setting_mode <> N'OWN' THEN 1 ELSE 0 END AS goes_up
    FROM idoc.account AS a
    CROSS JOIN (VALUES (N'envelopes'), (N'brands'), (N'matching'), (N'sequence'), (N'emails'), (N'costing'), (N'inserts')) AS g(setting)
    CROSS APPLY (SELECT CASE g.setting WHEN N'envelopes' THEN a.envelopes_mode WHEN N'brands' THEN a.brands_mode WHEN N'matching' THEN a.matching_mode
                                       WHEN N'sequence' THEN a.sequence_mode WHEN N'costing' THEN a.costing_mode WHEN N'inserts' THEN a.inserts_mode ELSE a.emails_mode END AS setting_mode) AS m),
walk AS (
    SELECT account_id AS origin, account_id AS node_id, parent_account_id AS next_id, setting, 0 AS depth, adds_self, goes_up FROM node
    UNION ALL
    SELECT w.origin, n.account_id, n.parent_account_id, w.setting, w.depth + 1, n.adds_self, n.goes_up
    FROM walk AS w INNER JOIN node AS n ON n.account_id = w.next_id AND n.setting = w.setting WHERE w.goes_up = 1)
SELECT origin AS account_id, setting, node_id AS source_account_id, depth FROM walk WHERE adds_self = 1;
GO

-- The envelope list's sources (kept under its old name).
CREATE VIEW idoc.v_account_envelope_source AS
SELECT account_id, source_account_id, depth FROM idoc.v_account_setting_source WHERE setting = N'envelopes';
GO

-- For every account, the account that is invoiced for its mail (its own choice, else the account that holds the settings).
CREATE VIEW idoc.v_account_invoicing AS
SELECT a.account_id, COALESCE(a.invoicing_account_id, o.owner_account_id) AS invoicing_account_id
FROM idoc.account AS a INNER JOIN idoc.v_account_owner AS o ON o.account_id = a.account_id;
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

-- The sizes an insert can be shown as (A4, A3, DL, ...). A list kept in Settings.
CREATE TABLE idoc.insert_size (
    insert_size_id INT IDENTITY(1, 1) NOT NULL CONSTRAINT pk_insert_size PRIMARY KEY,
    name           NVARCHAR(30)       NOT NULL CONSTRAINT uq_insert_size_name UNIQUE
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
    -- Inserts only (is_insert = 1): the size it is shown as, its H-POD id, whether the customer is charged for it, and what it costs and sells for (margin = sell - cost).
    insert_size_id       INT                NULL CONSTRAINT fk_stock_insize REFERENCES idoc.insert_size (insert_size_id),
    hpod_guid            UNIQUEIDENTIFIER   NULL,
    is_chargeable        BIT                NOT NULL CONSTRAINT df_stock_chargeable DEFAULT (0),
    cost_price           DECIMAL(10, 4)     NULL,
    sell_price           DECIMAL(10, 4)     NULL,
    is_stock_managed     BIT                NOT NULL CONSTRAINT df_stock_managed DEFAULT (0),
    is_active            BIT                NOT NULL CONSTRAINT df_stock_active DEFAULT (1),
    -- 'WH' codes are warehouse-managed stock; other codes are provisional until stock management assigns one
    is_warehouse_code    AS (CAST(CASE WHEN stock_code LIKE N'WH%' THEN 1 ELSE 0 END AS BIT)) PERSISTED
);
GO
CREATE UNIQUE INDEX uq_stock_code ON idoc.stock_item (stock_code) WHERE stock_code IS NOT NULL;
CREATE UNIQUE INDEX ux_stock_legacy ON idoc.stock_item (legacy_id) WHERE legacy_id IS NOT NULL;
CREATE UNIQUE INDEX ux_stock_hpod ON idoc.stock_item (hpod_guid) WHERE hpod_guid IS NOT NULL;
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
    account_id    INT                   NOT NULL CONSTRAINT fk_job_account REFERENCES idoc.account (account_id), -- the root of the account tree (the batching boundary)
    base_name     NVARCHAR(260)         NOT NULL,   -- shared file stem of the .xml / .pdf pair
    xml_file_name NVARCHAR(260)         NOT NULL,
    pdf_file_name NVARCHAR(260)         NOT NULL,
    export_date   DATETIME2(0)          NOT NULL,   -- ingest time (FileMaker stamps this in the XSLT)
    status        NVARCHAR(30)          NOT NULL CONSTRAINT df_job_status DEFAULT (N'Received'),
    pack_count    INT                   NULL,
    page_count    INT                   NULL,
    -- XML-first import: the job is saved from the XML alone with status 'Awaiting PDF'. When the PDF arrives it is checked against the
    -- pack page ranges and the status becomes 'Received' (or 'PDF Rejected' with pdf_error). An overdue PDF triggers an e-mail alert.
    pdf_received_at   DATETIME2(0)  NULL,
    pdf_last_alert_at DATETIME2(0)  NULL,
    pdf_alert_count   INT           NOT NULL CONSTRAINT df_job_alerts DEFAULT (0),
    pdf_error         NVARCHAR(2000) NULL,
    run_sheets_emailed_at DATETIME2(0) NULL,  -- when the run sheets were e-mailed to production (automatically once, or by the Resend button)
    CONSTRAINT uq_job_base UNIQUE (account_id, base_name),
    CONSTRAINT ck_job_status CHECK (status IN (N'Received', N'Awaiting PDF', N'PDF Rejected'))
);
GO
CREATE INDEX ix_job_awaiting_pdf ON idoc.job (status) WHERE status = N'Awaiting PDF';
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
CREATE SEQUENCE idoc.batch_code_seq AS BIGINT START WITH 1 INCREMENT BY 1 NO CYCLE NO CACHE;  -- NO CACHE: no gaps after a server restart
GO
CREATE TABLE idoc.batch (
    batch_id                BIGINT IDENTITY(1, 1) NOT NULL CONSTRAINT pk_batch PRIMARY KEY,
    job_id                  BIGINT                NOT NULL CONSTRAINT fk_batch_job REFERENCES idoc.job (job_id),
    account_id              INT                   NOT NULL CONSTRAINT fk_batch_account REFERENCES idoc.account (account_id),
    brand_id                INT                   NULL CONSTRAINT fk_batch_brand REFERENCES idoc.brand (brand_id),
    invoicing_account_id    INT                   NOT NULL CONSTRAINT fk_batch_invoicing REFERENCES idoc.account (account_id), -- part of the batch key: one run sheet, one job number
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
    CONSTRAINT ck_batch_status CHECK (current_status IN (N'Created', N'Printed', N'Enclosed', N'Despatched', N'Cancelled')),
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

-- One row per thing that happened to a batch, oldest first. batch.current_status always equals the latest event_type
-- (idoc.batch_event is written together with it, see MssqlRepository.recordBatchEvent). Rows are never updated or deleted.
CREATE TABLE idoc.batch_event (
    batch_event_id BIGINT IDENTITY(1, 1) NOT NULL CONSTRAINT pk_batch_event PRIMARY KEY,
    batch_id       BIGINT        NOT NULL CONSTRAINT fk_batch_event_batch REFERENCES idoc.batch (batch_id),
    event_type     NVARCHAR(30)  NOT NULL,
    occurred_at    DATETIME2(0)  NOT NULL CONSTRAINT df_batch_event_at DEFAULT (SYSUTCDATETIME()),
    recorded_by    NVARCHAR(100) NULL,    -- user or system that recorded it (NULL = the ingest watcher)
    note           NVARCHAR(400) NULL,
    CONSTRAINT ck_batch_event_type CHECK (event_type IN (N'Created', N'Printed', N'Enclosed', N'Despatched', N'Cancelled'))
);
CREATE INDEX ix_batch_event_batch ON idoc.batch_event (batch_id, occurred_at, batch_event_id);
GO

CREATE TABLE idoc.batch_insert (
    batch_id      BIGINT NOT NULL CONSTRAINT fk_batch_insert_batch REFERENCES idoc.batch (batch_id),
    stock_item_id INT    NOT NULL CONSTRAINT fk_batch_insert_stock REFERENCES idoc.stock_item (stock_item_id),
    quantity      INT    NOT NULL CONSTRAINT df_batch_insert_qty DEFAULT (1),
    CONSTRAINT pk_batch_insert PRIMARY KEY (batch_id, stock_item_id)
);
GO

-- The print files made from a batch (PDF composition). A batch is one file unless it passes max_pages_per_pdf, then it is split into segments.
-- Composing again replaces the rows (and the files) while the batch is still Created.
-- What the watcher and the composer are doing now, and what they did lately, for the Activity screen. Rows are written by the programs as they go
-- (a Running row is touched as it progresses); Done and Failed rows are kept for a few days. Nothing here is business data: losing it loses nothing.
CREATE TABLE idoc.activity (
    activity_id  BIGINT IDENTITY(1, 1) NOT NULL CONSTRAINT pk_activity PRIMARY KEY,
    kind         NVARCHAR(20)          NOT NULL,   -- Import (an XML, with or without its PDF) / PDF check (a PDF arriving for a waiting job) / Print files
    label        NVARCHAR(300)         NOT NULL,   -- the file name, or the job
    job_id       BIGINT                NULL,
    state        NVARCHAR(20)          NOT NULL,
    detail       NVARCHAR(500)         NULL,       -- what it is on now, or the outcome / error
    step_done    INT                   NULL,
    step_total   INT                   NULL,
    bytes        BIGINT                NULL,       -- size of the file the work is about (the PDF when one is read), for the queue's time estimate
    with_pdf     BIT                   NOT NULL CONSTRAINT df_activity_pdf DEFAULT (0),   -- a PDF is read as part of this work
    started_at   DATETIME2(0)          NOT NULL CONSTRAINT df_activity_started DEFAULT (SYSUTCDATETIME()),
    updated_at   DATETIME2(0)          NOT NULL CONSTRAINT df_activity_updated DEFAULT (SYSUTCDATETIME()),
    finished_at  DATETIME2(0)          NULL,
    CONSTRAINT ck_activity_kind CHECK (kind IN (N'Import', N'PDF check', N'Print files')),
    CONSTRAINT ck_activity_state CHECK (state IN (N'Running', N'Done', N'Failed', N'Abandoned'))
);
CREATE INDEX ix_activity_recent ON idoc.activity (activity_id DESC) INCLUDE (state);
GO

CREATE TABLE idoc.batch_file (
    batch_file_id    BIGINT IDENTITY(1, 1) NOT NULL CONSTRAINT pk_batch_file PRIMARY KEY,
    batch_id         BIGINT        NOT NULL CONSTRAINT fk_batch_file_batch REFERENCES idoc.batch (batch_id),
    segment_number   INT           NOT NULL,
    file_name        NVARCHAR(260) NOT NULL,
    mailpiece_count  INT           NOT NULL,
    page_count       INT           NOT NULL,   -- every page of the file: run sheet (segment 1), blank padding pages and all
    first_sequence   INT           NULL,       -- sequence numbers of the first and last mailpiece in the file
    last_sequence    INT           NULL,
    created_at       DATETIME2(0)  NOT NULL CONSTRAINT df_batch_file_created DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT uq_batch_file_segment UNIQUE (batch_id, segment_number),
    CONSTRAINT ck_batch_file_segment CHECK (segment_number >= 1)
);
GO

CREATE TABLE idoc.mailpiece (
    mailpiece_id         BIGINT IDENTITY(1, 1) NOT NULL CONSTRAINT pk_mailpiece PRIMARY KEY,
    job_id               BIGINT                NOT NULL CONSTRAINT fk_mp_job REFERENCES idoc.job (job_id),
    account_id           INT                   NOT NULL CONSTRAINT fk_mp_account REFERENCES idoc.account (account_id),
    address_id           BIGINT                NOT NULL CONSTRAINT fk_mp_address REFERENCES idoc.address (address_id),
    batch_id             BIGINT                NULL CONSTRAINT fk_mp_batch REFERENCES idoc.batch (batch_id),
    brand_id             INT                   NULL CONSTRAINT fk_mp_brand REFERENCES idoc.brand (brand_id),
    invoicing_account_id INT                   NOT NULL CONSTRAINT fk_mp_invoicing REFERENCES idoc.account (account_id), -- as at production
    account_envelope_id  INT                   NULL CONSTRAINT fk_mp_envelope REFERENCES idoc.account_envelope (account_envelope_id),
    -- Snapshot at production time, so later renaming or restructuring never changes past reports. The submitting account is the sub-account
    -- that sent every pack in the mailpiece (packs from different sub-accounts are never merged). The path runs from the top of the tree to it.
    submitting_account_id    INT               NOT NULL CONSTRAINT fk_mp_submitting REFERENCES idoc.account (account_id),
    submitting_account_code  NVARCHAR(100)     NOT NULL,
    submitting_account_name  NVARCHAR(200)     NOT NULL,
    submitting_account_path  NVARCHAR(1000)    NOT NULL,   -- account names, top of the tree first, separated by ' > '
    invoicing_account_code   NVARCHAR(100)     NOT NULL,
    invoicing_account_name   NVARCHAR(200)     NOT NULL,
    brand_name               NVARCHAR(200)     NULL,
    outer_stock_code         NVARCHAR(50)      NULL,       -- the outer envelope's stock code
    postal_format_id     INT                   NULL CONSTRAINT fk_mp_format REFERENCES idoc.postal_format (postal_format_id),
    postal_rate_id       INT                   NULL CONSTRAINT fk_mp_rate REFERENCES idoc.postal_rate (postal_rate_id),
    delivery_band        NVARCHAR(50)          NULL,   -- best (first alphabetically) of the merged packs' requested services
    pack_count           INT                   NOT NULL,
    page_count           INT                   NOT NULL,
    sheet_count          INT                   NOT NULL,
    sequence_number      INT                   NULL,   -- 1..n within the batch, in the order the mailpieces are printed; set when the batch is composed, then kept
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
    CONSTRAINT ck_mp_route CHECK (enclosing_route IS NULL OR enclosing_route IN (N'RECEPTION', N'MACHINE_CANDIDATE', N'HAND')),
    CONSTRAINT ck_mp_sequence CHECK (sequence_number IS NULL OR sequence_number >= 1)
);
GO
CREATE UNIQUE INDEX ux_mailpiece_sequence ON idoc.mailpiece (batch_id, sequence_number) WHERE sequence_number IS NOT NULL;
GO

/* ===========================================================================
   6. PACK
   =========================================================================== */
CREATE TABLE idoc.pack (
    pack_id               BIGINT IDENTITY(1, 1) NOT NULL CONSTRAINT pk_pack PRIMARY KEY,
    pack_guid             UNIQUEIDENTIFIER      NOT NULL,   -- idempotency / duplicate key
    job_id                BIGINT                NOT NULL CONSTRAINT fk_pack_job REFERENCES idoc.job (job_id),
    account_id            INT                   NOT NULL CONSTRAINT fk_pack_account REFERENCES idoc.account (account_id),            -- the root of the account tree (the batching boundary)
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
    -- Where the pack sits in the print file (PDF composition): its pages, including the blank page that makes it an even number of pages
    batch_file_id         BIGINT                NULL CONSTRAINT fk_pack_batch_file REFERENCES idoc.batch_file (batch_file_id),
    output_start_page     INT                   NULL,
    output_end_page       INT                   NULL,
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
INSERT INTO idoc.insert_size (name) VALUES (N'A3'), (N'A4'), (N'A5'), (N'A6'), (N'DL');

INSERT INTO idoc.postal_format (name, rank_order, max_weight_g, max_thickness_mm, max_sheets, max_length_mm, max_width_mm) VALUES
    (N'Letter',        1,  100,  5.00,   16, 240, 165),
    (N'Large Letter',  2,  750, 25.00,  125, 353, 250),
    (N'Small Parcel',  3, 2000, 160.00, NULL, 450, 350),
    (N'Medium Parcel', 4, 20000, 460.00, NULL, 610, 460);   -- Royal Mail's maximums: weight, length x width x thickness (depth); sheets have no limit

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

/* ===========================================================================
   11. PRODUCTION GATE
   A batch can only be printed, enclosed or despatched once the PDF of its job has arrived and been checked (job.status =
   'Received'). A job that is 'Awaiting PDF' or 'PDF Rejected' holds all of its batches. Cancelling is always allowed.
   MssqlRepository.recordBatchEvent checks this first and gives a readable message; the triggers are the backstop for any
   other writer (they stop a direct insert into batch_event or a direct update of batch.current_status).
   =========================================================================== */
CREATE VIEW idoc.v_batch_production AS
SELECT b.batch_id,
       b.batch_code,
       b.job_id,
       j.base_name AS job_name,
       j.status    AS job_status,
       b.current_status,
       CASE WHEN j.status = N'Received' THEN NULL
            WHEN j.status = N'Awaiting PDF' THEN N'Waiting for the PDF'
            ELSE N'PDF rejected' + COALESCE(N': ' + j.pdf_error, N'') END AS hold_reason,
       CAST(CASE WHEN j.status = N'Received' AND b.current_status = N'Created' THEN 1 ELSE 0 END AS BIT) AS can_print
FROM idoc.batch AS b
INNER JOIN idoc.job AS j ON j.job_id = b.job_id;
GO

CREATE TRIGGER idoc.trg_batch_event_gate ON idoc.batch_event AFTER INSERT AS
BEGIN
    SET NOCOUNT ON;
    IF EXISTS (SELECT 1 FROM inserted AS i
               INNER JOIN idoc.batch AS b ON b.batch_id = i.batch_id
               INNER JOIN idoc.job AS j ON j.job_id = b.job_id
               WHERE i.event_type IN (N'Printed', N'Enclosed', N'Despatched') AND j.status <> N'Received')
        THROW 50001, N'Production gate: a batch cannot be printed, enclosed or despatched until the PDF of its job has been received.', 1;
END;
GO

CREATE TRIGGER idoc.trg_batch_status_gate ON idoc.batch AFTER UPDATE AS
BEGIN
    SET NOCOUNT ON;
    IF UPDATE(current_status)
       AND EXISTS (SELECT 1 FROM inserted AS i
                   INNER JOIN deleted AS d ON d.batch_id = i.batch_id
                   INNER JOIN idoc.job AS j ON j.job_id = i.job_id
                   WHERE i.current_status <> d.current_status AND i.current_status IN (N'Printed', N'Enclosed', N'Despatched') AND j.status <> N'Received')
        THROW 50001, N'Production gate: a batch cannot be printed, enclosed or despatched until the PDF of its job has been received.', 1;
END;
GO

/* ===========================================================================
   12. COSTING MODELS
   A costing model is a named price list that belongs to a customer (the account that holds the settings) and applies between two
   dates. A model with no first day is a draft (the FileMaker import creates them): it is switched off and prices nothing until it is given a
   first day and switched on. A customer can have several over time; the one in force on the production date prices the mailpiece. A sub-account that
   inherits (costing_mode INHERIT, or inherits_settings = 1) uses the nearest ancestor's model (idoc.v_account_setting_source,
   setting 'costing'). Every charge has a cost (what it costs Latcham), a sell price (what the customer pays) and an adjustment
   (a per-customer change added to the sell price). Postage rates and their suggested sell price live on idoc.postal_rate.
   =========================================================================== */
CREATE TABLE idoc.costing_model (
    costing_model_id INT IDENTITY(1, 1) NOT NULL CONSTRAINT pk_costing_model PRIMARY KEY,
    account_id       INT                NOT NULL CONSTRAINT fk_costing_model_account REFERENCES idoc.account (account_id),
    name             NVARCHAR(200)      NOT NULL,
    valid_from       DATE               NULL,       -- NULL = a draft with no dates yet (never in force)
    valid_to         DATE               NULL,       -- NULL = until replaced
    is_active        BIT                NOT NULL CONSTRAINT df_costing_model_active DEFAULT (1),
    copied_from_id   INT                NULL CONSTRAINT fk_costing_model_copy REFERENCES idoc.costing_model (costing_model_id),
    comments         NVARCHAR(1000)     NULL,
    created_at       DATETIME2(0)       NOT NULL CONSTRAINT df_costing_model_created DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT ck_costing_model_dates CHECK (valid_to IS NULL OR valid_to >= valid_from),
    CONSTRAINT ck_costing_model_draft CHECK (valid_from IS NOT NULL OR (is_active = 0 AND valid_to IS NULL))
);
CREATE UNIQUE INDEX ux_costing_model_start ON idoc.costing_model (account_id, valid_from) WHERE valid_from IS NOT NULL;
GO

CREATE TABLE idoc.costing_model_rate (
    costing_model_id INT           NOT NULL CONSTRAINT fk_cmr_model REFERENCES idoc.costing_model (costing_model_id),
    charge_code      NVARCHAR(40)  NOT NULL,
    cost             DECIMAL(12, 4) NOT NULL CONSTRAINT df_cmr_cost DEFAULT (0),
    sell_price       DECIMAL(12, 4) NOT NULL CONSTRAINT df_cmr_sell DEFAULT (0),
    adjustment       DECIMAL(12, 4) NOT NULL CONSTRAINT df_cmr_adj DEFAULT (0),
    CONSTRAINT pk_costing_model_rate PRIMARY KEY (costing_model_id, charge_code),
    CONSTRAINT ck_cmr_code CHECK (charge_code IN (
        N'HPOD', N'PROCESSING', N'ADDRESS_MATCHING', N'PAPER_SHEET', N'COLOUR_PAGE', N'MONO_PAGE', N'BLANK_PAGE', N'INSERT',
        N'MACHINE_ENCLOSING_SETUP', N'MACHINE_ENCLOSING_SHEET', N'HAND_ENCLOSING_SETUP', N'HAND_ENCLOSING_SHEET', N'BAGGING', N'OVERSTICKERING',
        N'ADJUSTMENT', N'HAND_SMALL_BATCH_ADJUSTMENT', N'HAND_LETTER_ADJUSTMENT', N'HAND_LARGE_LETTER_ADJUSTMENT'))
);
GO

-- Price of each outer envelope for this model (the sell price can be adjusted per customer)
CREATE TABLE idoc.costing_model_envelope (
    costing_model_id INT            NOT NULL CONSTRAINT fk_cme_model REFERENCES idoc.costing_model (costing_model_id),
    stock_item_id    INT            NOT NULL CONSTRAINT fk_cme_stock REFERENCES idoc.stock_item (stock_item_id),
    cost             DECIMAL(12, 4) NOT NULL CONSTRAINT df_cme_cost DEFAULT (0),
    sell_price       DECIMAL(12, 4) NOT NULL CONSTRAINT df_cme_sell DEFAULT (0),
    adjustment       DECIMAL(12, 4) NOT NULL CONSTRAINT df_cme_adj DEFAULT (0),
    CONSTRAINT pk_costing_model_envelope PRIMARY KEY (costing_model_id, stock_item_id)
);
GO

-- Per-customer adjustment to a postage rate's suggested sell price
CREATE TABLE idoc.costing_model_postage (
    costing_model_id INT            NOT NULL CONSTRAINT fk_cmp_model REFERENCES idoc.costing_model (costing_model_id),
    postal_rate_id   INT            NOT NULL CONSTRAINT fk_cmp_rate REFERENCES idoc.postal_rate (postal_rate_id),
    adjustment       DECIMAL(12, 4) NOT NULL CONSTRAINT df_cmp_adj DEFAULT (0),
    CONSTRAINT pk_costing_model_postage PRIMARY KEY (costing_model_id, postal_rate_id)
);
GO

/* ===========================================================================
   13. PRICE AT PRODUCTION
   When a job is Received (its PDF has been read, so the page colours are known), every mailpiece in it is priced from the costing model in
   force on the production day. The model, the totals and every line are kept on the mailpiece, so a later change to a price list never
   changes what was charged. A mailpiece is left unpriced (priced_at NULL) when the customer has no costing model that day or a pack's page
   colours are unknown. price_warnings says what part of the price is missing (for example no postage rate).
   =========================================================================== */
ALTER TABLE idoc.mailpiece ADD
    costing_model_id INT            NULL CONSTRAINT fk_mp_costing_model REFERENCES idoc.costing_model (costing_model_id),
    production_cost  DECIMAL(12, 4) NULL,
    production_sell  DECIMAL(12, 4) NULL,
    postage_cost     DECIMAL(12, 4) NULL,
    postage_sell     DECIMAL(12, 4) NULL,
    priced_at        DATETIME2(0)   NULL,
    price_warnings   NVARCHAR(500)  NULL;
GO

/* ===========================================================================
   14. USAGE (after section 13, whose price columns it sums)
   One row per invoicing account, brand, UK calendar day, postal format and service, counted from the production snapshot on the
   mailpiece. The day is the date the mailpiece was produced (created_at is UTC, the day is the UK day). Mailpieces that are
   cancelled, or in a cancelled batch, are left out. Brand and invoicing account are as at production.
   =========================================================================== */
CREATE VIEW idoc.v_usage_daily AS
SELECT m.invoicing_account_id,
       m.invoicing_account_code,
       m.invoicing_account_name,
       COALESCE(m.brand_name, N'(no brand)')                                           AS brand,
       CAST(m.created_at AT TIME ZONE N'UTC' AT TIME ZONE N'GMT Standard Time' AS DATE) AS usage_day,
       COALESCE(pf.name, N'Unknown')                                                   AS postal_format,
       COALESCE(sv.name, m.delivery_band, N'Unknown')                                  AS postal_service,
       COUNT(*)                                                                        AS mailpieces,
       SUM(m.pack_count)                                                               AS packs,
       SUM(m.sheet_count)                                                              AS sheets,
       COUNT(m.priced_at)                                                              AS priced,            -- mailpieces that have a price
       COALESCE(SUM(m.production_sell), 0)                                             AS production_sell,   -- what would be invoiced (unpriced mail adds nothing)
       COALESCE(SUM(m.postage_sell), 0)                                                AS postage_sell,
       COALESCE(SUM(m.production_cost), 0)                                             AS production_cost,   -- internal: only the margin report reads the costs
       COALESCE(SUM(m.postage_cost), 0)                                                AS postage_cost
FROM idoc.mailpiece AS m
LEFT JOIN idoc.batch          AS b  ON b.batch_id = m.batch_id
LEFT JOIN idoc.postal_format  AS pf ON pf.postal_format_id = m.postal_format_id
LEFT JOIN idoc.postal_rate    AS r  ON r.postal_rate_id = m.postal_rate_id
LEFT JOIN idoc.postal_service AS sv ON sv.postal_service_id = r.postal_service_id
WHERE m.is_cancelled = 0 AND COALESCE(b.current_status, N'') <> N'Cancelled'
GROUP BY m.invoicing_account_id, m.invoicing_account_code, m.invoicing_account_name, COALESCE(m.brand_name, N'(no brand)'),
         CAST(m.created_at AT TIME ZONE N'UTC' AT TIME ZONE N'GMT Standard Time' AS DATE),
         COALESCE(pf.name, N'Unknown'), COALESCE(sv.name, m.delivery_band, N'Unknown');
GO

CREATE TABLE idoc.mailpiece_price_line (
    mailpiece_id BIGINT         NOT NULL CONSTRAINT fk_mpl_mailpiece REFERENCES idoc.mailpiece (mailpiece_id),
    line_no      INT            NOT NULL,
    charge_code  NVARCHAR(50)   NOT NULL,   -- a costing charge code, or ENVELOPE
    label        NVARCHAR(100)  NOT NULL,
    quantity     INT            NOT NULL,
    unit_cost    DECIMAL(12, 4) NOT NULL,
    unit_sell    DECIMAL(12, 4) NOT NULL,
    cost         DECIMAL(12, 4) NOT NULL,
    sell         DECIMAL(12, 4) NOT NULL,
    CONSTRAINT pk_mailpiece_price_line PRIMARY KEY (mailpiece_id, line_no)
);
GO
