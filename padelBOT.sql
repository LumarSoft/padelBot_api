-- MySQL dump 10.13  Distrib 9.6.0, for macos26.4 (arm64)
--
-- Host: localhost    Database: padelBOT
-- ------------------------------------------------------
-- Server version	9.6.0

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;
SET @MYSQLDUMP_TEMP_LOG_BIN = @@SESSION.SQL_LOG_BIN;
SET @@SESSION.SQL_LOG_BIN= 0;

--
-- GTID state at the beginning of the backup 
--

SET @@GLOBAL.GTID_PURGED=/*!80000 '+'*/ 'aed12bfc-6388-11f1-9348-cf73d1be4621:1-487914';

--
-- Table structure for table `_prisma_migrations`
--

DROP TABLE IF EXISTS `_prisma_migrations`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `_prisma_migrations` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `checksum` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `finished_at` datetime(3) DEFAULT NULL,
  `migration_name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `logs` text COLLATE utf8mb4_unicode_ci,
  `rolled_back_at` datetime(3) DEFAULT NULL,
  `started_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `applied_steps_count` int unsigned NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `_prisma_migrations`
--

LOCK TABLES `_prisma_migrations` WRITE;
/*!40000 ALTER TABLE `_prisma_migrations` DISABLE KEYS */;
INSERT INTO `_prisma_migrations` VALUES ('0484bd69-7e42-4abb-aec4-cc0e43d2e7ab','354870c3e4ec4487fcddbaad5833af06b7d70587178f32686a458627752c7ddc','2026-06-23 02:30:41.602','20260619210522_add_courts_and_slots',NULL,NULL,'2026-06-23 02:30:41.582',1),('08a34cc8-5139-4c69-9c49-b78af7b5250d','5f9dc1323c1f819ee806e82285c7eac4f7bef80abc084999b7e28cfc72e57691','2026-06-23 02:50:25.048','20260622130000_drop_mp_preference_id',NULL,NULL,'2026-06-23 02:50:25.040',1),('0abafd2f-f818-4dbd-a8df-14962fcd3b64','1b8ad4e4a4fc8e99649a3bc4bc9119b1166d067ff4ad966b7e8ca711f3a168ff','2026-06-23 02:30:41.569','20260605190020_init',NULL,NULL,'2026-06-23 02:30:41.566',1),('1b22b03d-a5b7-4dbb-94be-f234997853e5','7aa18d327d20a95c17236f473ef4bbfb4e20f86dc7e8423454605530b4831601','2026-07-14 01:35:10.885','20260711160000_add_club_setup_state',NULL,NULL,'2026-07-14 01:35:10.866',1),('1dd59da9-37c3-4290-991e-c112ac172cb4','3b24bf6fda83b557cc382c1f9600b1072970ea7a199bd8bd75501ccbd70e04a5','2026-06-23 02:30:41.722','20260622004139_add_transfer_payment_config',NULL,NULL,'2026-06-23 02:30:41.705',1),('2043d3ff-e38b-4014-8945-f8648ab2ecca','a27a9b8d2358e01c89bdfdf8718ebbdd31d3f9d4dc375b95a140c1db39cfccd4','2026-06-23 02:30:41.691','20260621202051_add_court_schedule',NULL,NULL,'2026-06-23 02:30:41.686',1),('285f2eb9-7aaf-48fe-ad03-f6c15d3c249a','57f19c45a0f1b6ba34f961b8c0b3e49493ff6fa3b06f748de8105e57e1c4c21f','2026-06-23 02:30:41.673','20260620183954_add_whatsapp_lines',NULL,NULL,'2026-06-23 02:30:41.666',1),('357a6338-4af4-4cee-9e59-9093128e086f','c4e098b2a799d896f2fa74ecfedeab822342ee53f30812d126d21641c0c75e2f','2026-06-23 02:50:25.051','20260622140000_add_processed_webhook_message',NULL,NULL,'2026-06-23 02:50:25.048',1),('40f53a8d-265b-4e0c-9b73-446f976250b7','7feededeacdd0412d544902c9b6955f19253d7d19cf778d7bad0734af48c725c','2026-07-14 01:35:10.893','20260711210000_add_contact_window_note',NULL,NULL,'2026-07-14 01:35:10.889',1),('41a345a5-06f3-4f22-b906-c9adbf2e46fd','85eda810e1d52bb4dfa1094dc3a786fd707a0ff64600e71f3096c389ef82225d','2026-06-23 22:23:07.294','20260623190000_add_deposit_mode',NULL,NULL,'2026-06-23 22:23:07.251',1),('44e0b4fc-288a-429f-b885-a87ee023134d','ecb866c43361f3328cc52bdf0810218e1a6e9cf29d598b9330336b7c1a903f2d','2026-06-23 02:50:25.040','20260622120000_add_mercadopago_oauth',NULL,NULL,'2026-06-23 02:50:25.011',1),('49291ed0-e338-482a-9e25-5d3b930a896d','ca53827104055ab267789677ddd69c60d8f2c1a71e3aca20c3877ed357242166','2026-07-14 01:35:10.915','20260711220000_add_ops_console',NULL,NULL,'2026-07-14 01:35:10.893',1),('4da5f94e-47e9-4afc-9961-9a7689c76564','8e63cb09f97154bd2016746a5e8b2cdd70df74af123768cdf0e35dd419f58a5c','2026-06-23 02:30:41.666','20260620160832_court_price_and_optional_phone',NULL,NULL,'2026-06-23 02:30:41.657',1),('559ef047-f0ff-4b45-9a81-63d6860efc13','3fb5505e00fb8bf7e9eca672f6c7e024aeeead9f62d4d139225bad3d05acbd55','2026-07-14 01:35:10.593','20260709003246_add_device_token',NULL,NULL,'2026-07-14 01:35:10.552',1),('56ba64d9-7840-4576-bf55-bf77b6b9fe18','26d974eb688a769a904a02e29c1c6cc77f304ed5e992b3da94c2122c92c5be67','2026-07-14 01:35:10.710','20260709234412_add_user_active_flags',NULL,NULL,'2026-07-14 01:35:10.699',1),('60c57611-75db-4d0b-8400-2936e8cafb21','a4f99035b62dd01fb50280a250d386171d10dc921d369865a55b02c77ead016f','2026-06-23 02:30:41.680','20260620185203_bot',NULL,NULL,'2026-06-23 02:30:41.673',1),('619cc900-d0d6-4077-a72b-2dd867ca2a11','a4e15b03150ed6e1010862dfcad8d8ac30216208e7c11af41ca5de8d1ae51cc5','2026-07-14 01:35:10.785','20260710180545_add_player_crm',NULL,NULL,'2026-07-14 01:35:10.724',1),('6d3d3ed1-b27d-493e-8c56-a9a598a35b2b','eb044e368eff34ae8b622df30236c4eb7bc24c40265db7717597a0e7ff990536','2026-06-24 01:59:26.955','20260623220000_payment_identity',NULL,NULL,'2026-06-24 01:59:26.918',1),('7a0be3c8-c356-42b7-8963-f230ca14d385','1506e0db9c93ed6f85d5b26116c13c42d26c863a7500fa432ce87c24a7ea88b1','2026-06-23 02:30:41.582','20260619204427_add_clubs_and_user_auth',NULL,NULL,'2026-06-23 02:30:41.569',1),('7c8efc05-53ef-46a6-8250-074f6689a178','f5495bb2657429dd7570db0be7f659e78f69fff7dd5091ad9732fafe557297c1','2026-06-23 02:30:41.705','20260621213940_add_pending_payment',NULL,NULL,'2026-06-23 02:30:41.696',1),('7ebb318a-1139-4c08-af0c-e237f2948a55','0e357d27d8b49e87263e0bd357bd3d52224bcd5e0a71e56367f4e77e18d4f42b','2026-06-24 01:24:17.323','20260623210000_recurring_until_date',NULL,NULL,'2026-06-24 01:24:17.293',1),('87fd198a-d9cd-4139-8a73-90f787ab2f84','c420645d527fc3c740bbb8dc09f47f435e480b451c28afe704b071c629981757','2026-06-23 02:30:41.696','20260621203043_add_court_type',NULL,NULL,'2026-06-23 02:30:41.691',1),('8ca87b11-bcf7-4333-9730-914656eebd9d','d523fccee40f6587dbcb5952a2c7d200b1f629c24b54e020769c51ce233054ac','2026-07-14 01:35:10.724','20260710175021_add_club_subscription',NULL,NULL,'2026-07-14 01:35:10.710',1),('93664f29-cf4a-4e02-a2f9-3cda649008f1','a8cdc2111d5f6a1d76625cee561c5dd18685098e2b02ab5c53d13e64937c8244','2026-07-14 01:35:10.818','20260711024450_add_club_signup_request',NULL,NULL,'2026-07-14 01:35:10.815',1),('95d373fd-0081-4f55-b3af-fc7dd43aa103','a842815fc5ea2f5ebccfafa5823c0454fe27b091a9c272fb62609f6a2125fa88','2026-06-23 02:30:41.686','20260621120000_unique_slot_court_starts_at',NULL,NULL,'2026-06-23 02:30:41.680',1),('9850ca95-a183-4e70-9fb3-ca46a536de94','272a3ef8f78db6f864600966a0404a6adafc88a9ceaa0b47efbcae5f3711b6f6','2026-07-14 01:35:10.680','20260709044145_add_booking_reminder_sent_at',NULL,NULL,'2026-07-14 01:35:10.643',1),('98679a6f-b4e2-46a8-b35d-f11dbcb98810','3944efd6330d05bde4b34b883c3e3e8b0595f6ce8f9c58ddef3b0cece7aac9e0','2026-06-24 02:23:35.695','20260623230000_conversation_needs_advisor',NULL,NULL,'2026-06-24 02:23:35.693',1),('9ffb8c71-5f3b-42f6-93c6-71c64ae25c02','0e1e8d0d10d5d27417a297aa0fbfb0808dc4b021216fd3b1f713ca94559ac938','2026-07-14 01:35:10.815','20260710183506_add_waitlist',NULL,NULL,'2026-07-14 01:35:10.806',1),('a02c6054-22cc-4c55-acec-99dd091dda29','decdde682e36db0fdc190c45b1301bfc3c54922f709bb91550490700210b962f','2026-07-14 01:35:10.805','20260710181759_add_cancellation_policy',NULL,NULL,'2026-07-14 01:35:10.785',1),('acb16bda-b89c-4cc1-bdfa-7ff5ad6a641f','c9d3f9e7b8a62b4b45fa2253cb623027c5ed58b5677a9feb157dec1c8b9f86be','2026-07-14 01:35:10.844','20260711032228_add_bot_copy_and_scheduled_prices',NULL,NULL,'2026-07-14 01:35:10.826',1),('b07439d2-30ac-4849-bffc-54c8fa34ee47','e3925a4ec0dc89899e532b7dda914bd426c3de6a446d0e5c7264ca0871e05f35','2026-06-24 00:54:42.652','20260623200000_add_court_price_rule',NULL,NULL,'2026-06-24 00:54:42.598',1),('b085a12f-7b6a-442d-98f9-7d65dffcf495','743cff1ac0ff4e440fa1b9b0e837ca28169d17813eb5f1038eadeca9a4158732','2026-06-23 02:30:41.733','20260622021845_add_conversation_messages',NULL,NULL,'2026-06-23 02:30:41.723',1),('b5ca65d7-c18c-4a54-a578-92aa35af38b2','d9f0983430822a6e48b5842aa15eb6add1da1108c08dee3848efca3686657f25','2026-07-14 01:35:10.690','20260709051229_add_player_mask_to_booking_product',NULL,NULL,'2026-07-14 01:35:10.680',1),('d347701f-f4b7-4ceb-9f69-02972d70569a','bfead4e27cd8e00de79b52594a3b66982b3685cf0d2e5ed880c1c310029fe290','2026-07-14 01:35:10.934','20260712200000_player_reschedule_policy',NULL,NULL,'2026-07-14 01:35:10.915',1),('d9f95546-288f-48ec-af08-9ff28e2c8fb8','14675306fb7cf47da4317cc41ff26f46d26c793773163f5054ee4bf04a99d4d6','2026-07-14 01:35:10.643','20260709042706_add_products',NULL,NULL,'2026-07-14 01:35:10.593',1),('e4c132fc-dc3b-4895-b6e7-8cffde012a9e','fde4e4fffa91d184ab078cfe98487bf499f0c672572896d7a80d878f4eec64c5','2026-07-14 01:35:10.825','20260711025051_add_local_payment',NULL,NULL,'2026-07-14 01:35:10.818',1),('e965d592-c333-4f10-a2f3-0fdf51714c88','5978d7f8377c9205b839b6cc2dbc1306fd386b5348cb59d7d930891a8bf668be','2026-07-14 01:35:10.698','20260709232203_add_court_schedule_config',NULL,NULL,'2026-07-14 01:35:10.691',1),('ecb2c156-d4b0-4dbc-aad8-386d5bae84cb','38e9049453e70179e7ab8bf9d830d0f33895693ecd85a3dca8c71af563ac944f','2026-07-14 01:35:10.889','20260711190000_enrich_club_signup_request',NULL,NULL,'2026-07-14 01:35:10.885',1),('f01b3c19-d465-47da-913f-42e49af90702','83975f92409fd10305efb52f72e0a6215ad7737ebba9c21bb0333300a9307414','2026-07-14 01:35:10.865','20260711034430_add_booking_player_payments',NULL,NULL,'2026-07-14 01:35:10.845',1),('f633cb2a-8cde-4b82-b854-454638f46525','5ed68a49bc863ea4459647a3b701290af85a5522c82d462138d115ceacab79c0','2026-07-14 01:35:10.551','20260626190000_add_payment_verification_mode_and_receipts',NULL,NULL,'2026-07-14 01:35:10.440',1),('ff043a55-c428-446e-b9b1-1db4c556b7fc','eecde6941ec8ff1d95918595e22325b4bf8eae2932104f507387655870a2eaf4','2026-06-23 02:30:41.656','20260620150156_add_booking_and_recurring_booking',NULL,NULL,'2026-06-23 02:30:41.603',1);
/*!40000 ALTER TABLE `_prisma_migrations` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `Booking`
--

DROP TABLE IF EXISTS `Booking`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `Booking` (
  `id` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `slotId` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `clubId` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `playerName` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `playerPhone` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` enum('PENDING_PAYMENT','CONFIRMED','CANCELLED') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'PENDING_PAYMENT',
  `notes` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `bookedByUserId` int DEFAULT NULL,
  `recurringBookingId` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` datetime(3) NOT NULL,
  `depositCents` int NOT NULL DEFAULT '0',
  `mpPaymentId` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `paymentExpiresAt` datetime(3) DEFAULT NULL,
  `transferAmountCents` int DEFAULT NULL,
  `playerDni` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `payerCuit` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `payerEmail` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `payerMpUserId` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `receiptUploadedAt` datetime(3) DEFAULT NULL,
  `reminderSentAt` datetime(3) DEFAULT NULL,
  `noShowAt` datetime(3) DEFAULT NULL,
  `playerId` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `creditAppliedCents` int NOT NULL DEFAULT '0',
  `depositOutcome` enum('CREDITED','FORFEITED','REFUNDED') COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `localPaymentCents` int NOT NULL DEFAULT '0',
  `localPaymentMethod` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `settledAt` datetime(3) DEFAULT NULL,
  `rescheduleCount` int NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  KEY `Booking_clubId_idx` (`clubId`),
  KEY `Booking_slotId_idx` (`slotId`),
  KEY `Booking_recurringBookingId_idx` (`recurringBookingId`),
  KEY `Booking_clubId_status_idx` (`clubId`,`status`),
  KEY `Booking_bookedByUserId_fkey` (`bookedByUserId`),
  KEY `Booking_status_paymentExpiresAt_idx` (`status`,`paymentExpiresAt`),
  KEY `Booking_status_transferAmountCents_idx` (`status`,`transferAmountCents`),
  KEY `Booking_status_reminderSentAt_idx` (`status`,`reminderSentAt`),
  KEY `Booking_playerId_idx` (`playerId`),
  CONSTRAINT `Booking_bookedByUserId_fkey` FOREIGN KEY (`bookedByUserId`) REFERENCES `User` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `Booking_clubId_fkey` FOREIGN KEY (`clubId`) REFERENCES `Club` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `Booking_playerId_fkey` FOREIGN KEY (`playerId`) REFERENCES `Player` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `Booking_recurringBookingId_fkey` FOREIGN KEY (`recurringBookingId`) REFERENCES `RecurringBooking` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `Booking_slotId_fkey` FOREIGN KEY (`slotId`) REFERENCES `Slot` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `Booking`
--

LOCK TABLES `Booking` WRITE;
/*!40000 ALTER TABLE `Booking` DISABLE KEYS */;
INSERT INTO `Booking` VALUES ('cmqr9cgyb00099mvbbap6uwnt','cmqr9cgy000019mvb48q0mtg5','cmqq1kmvm0000fsvbxvn7vzvb','dvxcb','34147654','CANCELLED',NULL,NULL,NULL,'2026-06-23 23:10:35.987','2026-06-24 00:59:36.877',0,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,0,NULL,0,NULL,NULL,0),('cmqr9cgyc000a9mvbsvha1e1d','cmqr9cgy200029mvbr3coyzxw','cmqq1kmvm0000fsvbxvn7vzvb','dvxcb','34147654','CANCELLED',NULL,NULL,NULL,'2026-06-23 23:10:35.988','2026-06-24 00:59:36.114',0,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,0,NULL,0,NULL,NULL,0),('cmqr9cgye000b9mvbfvd9xinn','cmqr9cgy300039mvbmq1leox1','cmqq1kmvm0000fsvbxvn7vzvb','dvxcb','34147654','CANCELLED',NULL,NULL,NULL,'2026-06-23 23:10:35.990','2026-06-24 00:59:35.277',0,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,0,NULL,0,NULL,NULL,0),('cmqr9cgyf000c9mvbu2jj0iuh','cmqr9cgy300049mvbvpmyfcrp','cmqq1kmvm0000fsvbxvn7vzvb','dvxcb','34147654','CANCELLED',NULL,NULL,NULL,'2026-06-23 23:10:35.991','2026-06-24 00:59:34.529',0,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,0,NULL,0,NULL,NULL,0),('cmqr9cgyg000d9mvb3ywx6ncm','cmqr9cgy400059mvb7ig994ck','cmqq1kmvm0000fsvbxvn7vzvb','dvxcb','34147654','CANCELLED',NULL,NULL,NULL,'2026-06-23 23:10:35.992','2026-06-24 00:59:33.695',0,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,0,NULL,0,NULL,NULL,0),('cmqr9cgyh000e9mvbk90qtzm7','cmqr9cgy500069mvbd33gtkg6','cmqq1kmvm0000fsvbxvn7vzvb','dvxcb','34147654','CANCELLED',NULL,NULL,NULL,'2026-06-23 23:10:35.993','2026-06-24 00:59:32.662',0,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,0,NULL,0,NULL,NULL,0),('cmqr9cgyi000f9mvbx5fmm7bd','cmqr9cgy500079mvbiaakp569','cmqq1kmvm0000fsvbxvn7vzvb','dvxcb','34147654','CANCELLED',NULL,NULL,NULL,'2026-06-23 23:10:35.994','2026-06-24 00:59:30.963',0,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,0,NULL,0,NULL,NULL,0),('cmqr9cgyk000g9mvblu32gz5c','cmqr9cgy600089mvbrvnh1wpb','cmqq1kmvm0000fsvbxvn7vzvb','dvxcb','34147654','CANCELLED',NULL,NULL,NULL,'2026-06-23 23:10:35.996','2026-06-24 00:59:29.688',0,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,0,NULL,0,NULL,NULL,0),('cmqrae2lh000iplvbc89ldfx3','cmqrae2lc000hplvbev9rnpyl','cmqq1kmvm0000fsvbxvn7vzvb','Mejor para mañana a las 22.30','5493416956364','CANCELLED',NULL,NULL,NULL,'2026-06-23 23:39:50.309','2026-06-24 00:19:36.128',300000,NULL,'2026-06-24 00:09:50.300',300000,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,0,NULL,0,NULL,NULL,0),('cmqrej9x3000g93vb1qbu55gm','cmqrej9x0000f93vby8rkljwj','cmqq1kmvm0000fsvbxvn7vzvb','Mejor para mañana a las 22.30','5493416956364','CONFIRMED',NULL,NULL,NULL,'2026-06-24 01:35:51.543','2026-06-24 01:37:05.166',1000000,'164718848685','2026-06-24 02:05:51.536',1000000,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,0,NULL,0,NULL,NULL,0),('cmqrfnd09000e5svbqz4nwwrk','cmqrfnd04000d5svb390n6p08','cmqq1kmvm0000fsvbxvn7vzvb','Mejor para mañana a las 22.30','5493416956364','CONFIRMED',NULL,NULL,NULL,'2026-06-24 02:07:01.785','2026-06-24 02:07:54.407',300000,'165544974846','2026-06-24 02:37:01.775',300000,NULL,'20447652839','lucas.quaroni@gmail.com','206515141',NULL,NULL,NULL,NULL,0,NULL,0,NULL,NULL,0),('cmqrge6ph000cvdvb098d42k5','cmqrge6pd000bvdvb928uzbmp','cmqq1kmvm0000fsvbxvn7vzvb','Lucas Quaroni','5493416956364','CONFIRMED',NULL,NULL,NULL,'2026-06-24 02:27:53.333','2026-06-24 02:28:26.382',300000,'164723232821','2026-06-24 02:57:53.321',300000,'44765283','20447652839','lucas.quaroni@gmail.com','206515141',NULL,NULL,NULL,NULL,0,NULL,0,NULL,NULL,0),('cmrjzy6tn000f9avbnbberg71','cmrjzy6tm000e9avbyzoaapv6','cmqq1kmvm0000fsvbxvn7vzvb','Lucas Quaroni','5493410000001','CONFIRMED',NULL,NULL,NULL,'2026-07-14 01:52:52.235','2026-07-14 01:53:31.436',300000,NULL,'2026-07-14 02:22:52.233',300000,'38123456',NULL,NULL,NULL,NULL,NULL,NULL,'cmrjzy6th000d9avbplctxpy3',0,NULL,0,NULL,NULL,0),('cmrk0n6da000ewwvbql771s63','cmrk1mlwp0005knvbbpigvn53','cmqq1kmvm0000fsvbxvn7vzvb','Lucas Quaroni','5493416956364','CONFIRMED',NULL,NULL,NULL,'2026-07-14 02:12:18.046','2026-07-14 02:39:51.148',300000,'167833503019','2026-07-14 02:42:18.042',300000,'44765283','20447652839','lucas.quaroni@gmail.com','206515141',NULL,NULL,NULL,'cmrk0n6d1000cwwvb6lwguk67',0,NULL,0,NULL,NULL,1),('cmrk0rqdx0010wwvb8gwf2c46','cmrk0rqds000zwwvbd9yk4p9c','cmqq1kmvm0000fsvbxvn7vzvb','Mateas Donarumma','5493412776893','CONFIRMED',NULL,NULL,NULL,'2026-07-14 02:15:50.613','2026-07-14 02:16:41.256',300000,'168695426942','2026-07-14 02:45:50.607',300000,'44428719','20444287196','bodinidev@gmail.com','1296833279',NULL,NULL,NULL,'cmrk0rqdm000ywwvbrivp8v0q',0,NULL,0,NULL,NULL,0),('cmrk14m340006yzvbi4qu723j','cmrk14m320005yzvbwe7nmsqe','cmqq1kmvm0000fsvbxvn7vzvb','Mateas Donarumma','5493412776893','CONFIRMED',NULL,NULL,NULL,'2026-07-14 02:25:51.568','2026-07-14 02:30:55.481',1000000,'167834373819','2026-07-14 02:55:51.564',1000000,'44428719','20444287196','bodinidev@gmail.com','1296833279',NULL,NULL,NULL,'cmrk0rqdm000ywwvbrivp8v0q',0,NULL,0,NULL,NULL,0),('cmrk1ubrk0009bivb5ztuzc5x','cmrk29rpb000aiavbu8qty8h7','cmqq1kmvm0000fsvbxvn7vzvb','Lucas','5493410000001','CONFIRMED',NULL,NULL,NULL,'2026-07-14 02:45:51.248','2026-07-14 02:57:51.745',300000,'168697598246','2026-07-14 03:15:51.245',300000,'38123456',NULL,NULL,NULL,NULL,NULL,NULL,'cmrjzy6th000d9avbplctxpy3',0,NULL,0,NULL,NULL,1),('cmrk1yh1v000pbivbmseqr0y2','cmrk1yh1u000obivbz9rregto','cmqq1kmvm0000fsvbxvn7vzvb','Lucas','5493410000001','CANCELLED',NULL,NULL,NULL,'2026-07-14 02:49:04.723','2026-07-14 02:58:22.987',1000000,NULL,'2026-07-14 03:19:04.721',1000000,'38123456',NULL,NULL,NULL,NULL,NULL,NULL,'cmrjzy6th000d9avbplctxpy3',0,'FORFEITED',0,NULL,NULL,0),('cmrk2detc000oiavbf5duvdbm','cmrk2deta000niavb5repd07n','cmqq1kmvm0000fsvbxvn7vzvb','Cualquiera','5493410000001','PENDING_PAYMENT',NULL,NULL,NULL,'2026-07-14 03:00:41.664','2026-07-14 03:00:41.664',300000,NULL,'2026-07-14 03:30:41.662',300000,'38123456',NULL,NULL,NULL,NULL,NULL,NULL,'cmrjzy6th000d9avbplctxpy3',0,NULL,0,NULL,NULL,0);
/*!40000 ALTER TABLE `Booking` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `BookingPlayerPayment`
--

DROP TABLE IF EXISTS `BookingPlayerPayment`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `BookingPlayerPayment` (
  `id` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `bookingId` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `clubId` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `playerSlot` int NOT NULL,
  `amountCents` int NOT NULL,
  `method` enum('CASH','QR','TRANSFER') COLLATE utf8mb4_unicode_ci NOT NULL,
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `BookingPlayerPayment_bookingId_idx` (`bookingId`),
  KEY `BookingPlayerPayment_clubId_idx` (`clubId`),
  CONSTRAINT `BookingPlayerPayment_bookingId_fkey` FOREIGN KEY (`bookingId`) REFERENCES `Booking` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `BookingPlayerPayment_clubId_fkey` FOREIGN KEY (`clubId`) REFERENCES `Club` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `BookingPlayerPayment`
--

LOCK TABLES `BookingPlayerPayment` WRITE;
/*!40000 ALTER TABLE `BookingPlayerPayment` DISABLE KEYS */;
/*!40000 ALTER TABLE `BookingPlayerPayment` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `BookingProduct`
--

DROP TABLE IF EXISTS `BookingProduct`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `BookingProduct` (
  `id` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `bookingId` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `productId` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `clubId` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `quantity` int NOT NULL DEFAULT '1',
  `unitPriceCents` int NOT NULL,
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `playerMask` int NOT NULL DEFAULT '15',
  PRIMARY KEY (`id`),
  KEY `BookingProduct_bookingId_idx` (`bookingId`),
  KEY `BookingProduct_clubId_idx` (`clubId`),
  KEY `BookingProduct_productId_fkey` (`productId`),
  CONSTRAINT `BookingProduct_bookingId_fkey` FOREIGN KEY (`bookingId`) REFERENCES `Booking` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `BookingProduct_clubId_fkey` FOREIGN KEY (`clubId`) REFERENCES `Club` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `BookingProduct_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `BookingProduct`
--

LOCK TABLES `BookingProduct` WRITE;
/*!40000 ALTER TABLE `BookingProduct` DISABLE KEYS */;
/*!40000 ALTER TABLE `BookingProduct` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `Club`
--

DROP TABLE IF EXISTS `Club`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `Club` (
  `id` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `slug` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` datetime(3) NOT NULL,
  `transferAlias` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `transferHolder` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `mpAccessToken` text COLLATE utf8mb4_unicode_ci,
  `mpRefreshToken` text COLLATE utf8mb4_unicode_ci,
  `mpUserId` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `mpTokenExpiresAt` datetime(3) DEFAULT NULL,
  `mpConnectedAt` datetime(3) DEFAULT NULL,
  `depositMode` enum('DEPOSIT','FULL') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'DEPOSIT',
  `depositPercent` int NOT NULL DEFAULT '25',
  `requireDniMatch` tinyint(1) NOT NULL DEFAULT '0',
  `paymentVerificationMode` enum('AUTO','RECEIPT') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'AUTO',
  `currentPeriodEnd` datetime(3) DEFAULT NULL,
  `plan` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'base',
  `subscriptionStatus` enum('TRIAL','ACTIVE','PAST_DUE','CANCELLED') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'TRIAL',
  `trialEndsAt` datetime(3) DEFAULT NULL,
  `cancellationWindowHours` int NOT NULL DEFAULT '24',
  `botWelcomeExtra` text COLLATE utf8mb4_unicode_ci,
  `locationInfo` text COLLATE utf8mb4_unicode_ci,
  `setupCompletedAt` datetime(3) DEFAULT NULL,
  `setupProgress` json DEFAULT NULL,
  `playerReschedule` enum('SELF','REQUEST','OFF') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'SELF',
  `playerRescheduleCutoffHours` int DEFAULT '6',
  `maxPlayerReschedules` int NOT NULL DEFAULT '1',
  PRIMARY KEY (`id`),
  UNIQUE KEY `Club_slug_key` (`slug`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `Club`
--

LOCK TABLES `Club` WRITE;
/*!40000 ALTER TABLE `Club` DISABLE KEYS */;
INSERT INTO `Club` VALUES ('cmqq1kmvm0000fsvbxvn7vzvb','Lavalle Pádel','club-demo','2026-06-23 02:45:13.810','2026-06-24 02:15:05.660','lucasquaroni','Club Demo Pádel',NULL,NULL,NULL,NULL,NULL,'DEPOSIT',25,1,'AUTO',NULL,'base','TRIAL',NULL,24,NULL,NULL,'2026-07-13 22:35:10.878',NULL,'SELF',6,1);
/*!40000 ALTER TABLE `Club` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `ClubSignupRequest`
--

DROP TABLE IF EXISTS `ClubSignupRequest`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `ClubSignupRequest` (
  `id` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `clubName` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `ownerName` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `email` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `phone` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `message` text COLLATE utf8mb4_unicode_ci,
  `status` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'NEW',
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `city` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `courtCount` int DEFAULT NULL,
  `courtType` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `slotDurationMinutes` int DEFAULT NULL,
  `openTime` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `closeTime` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `avgPriceCents` int DEFAULT NULL,
  `chargesDeposit` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `hasMercadoPago` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `currentSystem` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `biggestPain` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `fixedSlots` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `howFound` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `contactWindow` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `contactWindowNote` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `internalNotes` text COLLATE utf8mb4_unicode_ci,
  `contactedAt` datetime(3) DEFAULT NULL,
  `convertedClubId` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `ClubSignupRequest_status_idx` (`status`),
  KEY `ClubSignupRequest_createdAt_idx` (`createdAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `ClubSignupRequest`
--

LOCK TABLES `ClubSignupRequest` WRITE;
/*!40000 ALTER TABLE `ClubSignupRequest` DISABLE KEYS */;
/*!40000 ALTER TABLE `ClubSignupRequest` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `ConversationMessage`
--

DROP TABLE IF EXISTS `ConversationMessage`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `ConversationMessage` (
  `id` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `sessionId` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `role` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `content` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `ConversationMessage_sessionId_idx` (`sessionId`),
  KEY `ConversationMessage_sessionId_createdAt_idx` (`sessionId`,`createdAt`),
  CONSTRAINT `ConversationMessage_sessionId_fkey` FOREIGN KEY (`sessionId`) REFERENCES `ConversationSession` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `ConversationMessage`
--

LOCK TABLES `ConversationMessage` WRITE;
/*!40000 ALTER TABLE `ConversationMessage` DISABLE KEYS */;
INSERT INTO `ConversationMessage` VALUES ('cmqr7pvw500013fvbh3phbonn','cmqr7pvw200003fvbg2sx3xw0','USER','Hola','2026-06-23 22:25:02.645'),('cmqr7pvwd00023fvbyg5ono54','cmqr7pvw200003fvbg2sx3xw0','BOT','👋 ¡Hola! Soy el asistente del club, encantado 🎾 Estoy para darte una mano con tus turnos.\n\nContame qué necesitás y lo resolvemos 🎾 Puedo reservar un turno, mostrarte tus reservas o cancelar una. Escribime con tus palabras, como por ejemplo *\"un turno para el sábado a la tarde\"*.','2026-06-23 22:25:02.653'),('cmqr7xf5i0000obvbihpbhupd','cmqr7pvw200003fvbg2sx3xw0','ADMIN','puto','2026-06-23 22:30:54.198'),('cmqrdimui000ajyvbotesk4x3','cmqr7pvw200003fvbg2sx3xw0','ADMIN','asd','2026-06-24 01:07:22.026'),('cmrk0pwbr000hwwvb2o0lf2pr','cmrk0pwbp000gwwvb3b3usffo','USER','Hola','2026-07-14 02:14:24.999'),('cmrk0pwbz000iwwvbace3x4pc','cmrk0pwbp000gwwvb3b3usffo','BOT','👋 ¡Hola! Soy *PadelBot*, el asistente del club 🎾\n\n¿Qué querés hacer?\n\n1️⃣ Reservar un turno\n2️⃣ Ver mis turnos (o cambiar uno de horario)\n\nRespondé con el número, o escribime con tus palabras (ej: *\"un turno el sábado a la tarde\"*).','2026-07-14 02:14:25.007'),('cmrk0q3j2000jwwvbqmokwbpb','cmrk0pwbp000gwwvb3b3usffo','USER','1','2026-07-14 02:14:34.334'),('cmrk0q3j9000kwwvbkk0gbk5a','cmrk0pwbp000gwwvb3b3usffo','BOT','📅 ¿Para qué día lo querés? Tocá una opción, o decime la fecha (ej: *25/06*).','2026-07-14 02:14:34.341'),('cmrk0q9ki000lwwvbphn3c2qn','cmrk0pwbp000gwwvb3b3usffo','USER','14/07','2026-07-14 02:14:42.162'),('cmrk0q9l8000mwwvb3toq2vsh','cmrk0pwbp000gwwvb3b3usffo','BOT','👤 ¡Genial! ¿A nombre de quién pongo la reserva?','2026-07-14 02:14:42.188'),('cmrk0qj5c000nwwvb5bcj4f2n','cmrk0pwbp000gwwvb3b3usffo','USER','Mateas donarumma','2026-07-14 02:14:54.576'),('cmrk0qj5z000owwvbkayb6ran','cmrk0pwbp000gwwvb3b3usffo','BOT','🎾 Para el *14/07* tengo estos turnos libres:\n\n*Cancha 1*\n• 09:00–10:30\n• 10:30–12:00\n• 12:00–13:30\n• 13:30–15:00\n• 15:00–16:30\n• 16:30–18:00\n• 18:00–19:30\n• 19:30–21:00\n• 21:00–22:30\n• 22:30–00:00\n\n*Cancha 2*\n• 09:00–10:30\n• 10:30–12:00\n• 12:00–13:30\n• 13:30–15:00\n• 15:00–16:30\n• 16:30–18:00\n• 18:00–19:30\n• 21:00–22:30\n• 22:30–00:00\n\nDecime el horario que querés (ej: *las 18*) y te asigno la cancha. 🎾','2026-07-14 02:14:54.599'),('cmrk0qsmq000pwwvbrxwf4azj','cmrk0pwbp000gwwvb3b3usffo','USER','A las 6 de la tarde','2026-07-14 02:15:06.866'),('cmrk0qsmy000qwwvb2w5yq1uu','cmrk0pwbp000gwwvb3b3usffo','BOT','😕 Para esa hora no me queda lugar.\n\n🎾 Para el *14/07* tengo estos turnos libres:\n\n*Cancha 1*\n• 09:00–10:30\n• 10:30–12:00\n• 12:00–13:30\n• 13:30–15:00\n• 15:00–16:30\n• 16:30–18:00\n• 18:00–19:30\n• 19:30–21:00\n• 21:00–22:30\n• 22:30–00:00\n\n*Cancha 2*\n• 09:00–10:30\n• 10:30–12:00\n• 12:00–13:30\n• 13:30–15:00\n• 15:00–16:30\n• 16:30–18:00\n• 18:00–19:30\n• 21:00–22:30\n• 22:30–00:00\n\nDecime el horario que querés (ej: *las 18*) y te asigno la cancha. 🎾','2026-07-14 02:15:06.874'),('cmrk0r4uk000rwwvbj9u75z0r','cmrk0pwbp000gwwvb3b3usffo','USER','18:00','2026-07-14 02:15:22.700'),('cmrk0r4ut000swwvbtbzet6l0','cmrk0pwbp000gwwvb3b3usffo','BOT','🎾 Para el *14/07* a las *18:00–19:30* tengo libre:\n\n• Cancha 1 — $40.000\n• Cancha 2 — $12.000\n\n¿Cuál preferís? O decime *\"cualquiera\"* y te asigno una. 🎾','2026-07-14 02:15:22.709'),('cmrk0r9lz000twwvb9lunot6e','cmrk0pwbp000gwwvb3b3usffo','USER','Cancha 2','2026-07-14 02:15:28.871'),('cmrk0r9m6000uwwvbgqem48od','cmrk0pwbp000gwwvb3b3usffo','BOT','📋 *Resumen de tu reserva:*\n\n📅 Fecha: 14/07\n🎾 Cancha: Cancha 2\n⏰ Horario: 18:00–19:30\n💰 Precio: $12.000\n👤 Nombre: Mateas Donarumma\n\n👀 Revisá que esté todo bien. Si coincide, confirmame y te lo dejo reservado 🎾','2026-07-14 02:15:28.878'),('cmrk0rfjl000vwwvb67qhna75','cmrk0pwbp000gwwvb3b3usffo','USER','si','2026-07-14 02:15:36.561'),('cmrk0rfjx000wwwvb0sqeyvfb','cmrk0pwbp000gwwvb3b3usffo','BOT','🪪 Para confirmar el pago necesito tu *DNI* (solo los números). Tiene que ser el del titular que va a transferir la seña.','2026-07-14 02:15:36.573'),('cmrk0rqdd000xwwvbfkym9c9q','cmrk0pwbp000gwwvb3b3usffo','USER','44428719','2026-07-14 02:15:50.593'),('cmrk0rqe50011wwvbg541uluy','cmrk0pwbp000gwwvb3b3usffo','BOT','⏳ *Reserva pre-confirmada — falta el pago*\n\n📅 14/07 · 18:00–19:30\n🎾 Cancha 2\n\nPara confirmar el turno, transferí la seña para reservar:\n\n💰 Importe: *$3.000*\n🏦 Alias: *lucasquaroni*\n👤 Titular: *Club Demo Pádel*\n\n⚠️ Importante: transferí *desde tu propia cuenta* de MercadoPago (a nombre del DNI *44428719*). Así confirmo tu pago solo; si transferís desde otra cuenta, lo reviso a mano.\n\n⏰ Tenés *30 minutos*. Cuando se acredite te aviso por acá; si no llega a tiempo, el turno queda libre.','2026-07-14 02:15:50.621'),('cmrk0t4td0012wwvb6q8br2nr','cmrk0pwbp000gwwvb3b3usffo','ADMIN','Morite de cancer','2026-07-14 02:16:55.969'),('cmrk0td510013wwvbo9yaosyv','cmrk0pwbp000gwwvb3b3usffo','USER','Devolverme la plata','2026-07-14 02:17:06.757'),('cmrk0tens0014wwvbfgsf6h2l','cmrk0pwbp000gwwvb3b3usffo','BOT','Lamentablemente, no puedo gestionar devoluciones ni pagos. Te recomiendo que hables directamente con el club para resolverlo. Si necesitas ayuda con otra cosa, ¡aquí estoy!','2026-07-14 02:17:08.728'),('cmrk13u9z0000yzvbyahc5ktk','cmrk0pwbp000gwwvb3b3usffo','USER','Quiero reservar otro turno','2026-07-14 02:25:15.527'),('cmrk13vxl0001yzvb0je6hee5','cmrk0pwbp000gwwvb3b3usffo','BOT','¡Perfecto! ¿Para qué fecha y horario te gustaría reservar el nuevo turno? 🎾','2026-07-14 02:25:17.673'),('cmrk14bgo0002yzvbx4qfp5nu','cmrk0pwbp000gwwvb3b3usffo','USER','18hs','2026-07-14 02:25:37.800'),('cmrk14cn20003yzvb3ufytna4','cmrk0pwbp000gwwvb3b3usffo','BOT','📋 *Resumen de tu reserva:*\n\n📅 Fecha: 14/07\n🎾 Cancha: Cancha 1\n⏰ Horario: 18:00–19:30\n💰 Precio: $40.000\n👤 Nombre: Mateas Donarumma\n\n👀 Revisá que esté todo bien. Si coincide, confirmame y te lo dejo reservado 🎾','2026-07-14 02:25:39.326'),('cmrk14m2a0004yzvbg9uhqby6','cmrk0pwbp000gwwvb3b3usffo','USER','si','2026-07-14 02:25:51.538'),('cmrk14m3a0007yzvbi4y320t0','cmrk0pwbp000gwwvb3b3usffo','BOT','⏳ *Reserva pre-confirmada — falta el pago*\n\n📅 14/07 · 18:00–19:30\n🎾 Cancha 1\n\nPara confirmar el turno, transferí la seña para reservar:\n\n💰 Importe: *$10.000*\n🏦 Alias: *lucasquaroni*\n👤 Titular: *Club Demo Pádel*\n\n⚠️ Importante: transferí *desde tu propia cuenta* de MercadoPago (a nombre del DNI *44428719*). Así confirmo tu pago solo; si transferís desde otra cuenta, lo reviso a mano.\n\n⏰ Tenés *30 minutos*. Cuando se acredite te aviso por acá; si no llega a tiempo, el turno queda libre.','2026-07-14 02:25:51.574'),('cmrk1ar7j0008yzvb7qnqw9n5','cmrk0pwbp000gwwvb3b3usffo','ADMIN','No me llego down de mierda','2026-07-14 02:30:38.143'),('cmrk1fas10009yzvb86b58xsn','cmqra7suf000h9mvbnl2mhb25','USER','hola','2026-07-14 02:34:10.129'),('cmrk1fasm000ayzvbex2hbwyf','cmqra7suf000h9mvbnl2mhb25','BOT','👋 ¡Hola! Soy *PadelBot*, el asistente del club 🎾\n\n¿Qué querés hacer?\n\n1️⃣ Reservar un turno\n2️⃣ Ver mis turnos (o cambiar uno de horario)\n\nRespondé con el número, o escribime con tus palabras (ej: *\"un turno el sábado a la tarde\"*).','2026-07-14 02:34:10.150'),('cmrk1foae000byzvb1s8fjhqd','cmqra7suf000h9mvbnl2mhb25','USER','2','2026-07-14 02:34:27.638'),('cmrk1foax000cyzvb8ejd4k82','cmqra7suf000h9mvbnl2mhb25','BOT','🗓️ *Tus próximos turnos:*\n\n• miércoles 15/07 · 22:30–00:00 · Cancha 2\n\n¿Necesitás mover alguno? Elegilo de la lista. 🎾','2026-07-14 02:34:27.657'),('cmrk1fs5a000dyzvbzbswwfib','cmqra7suf000h9mvbnl2mhb25','USER','turno:cmrk0n6da000ewwvbql771s63','2026-07-14 02:34:32.638'),('cmrk1fs5s000eyzvbl0byoyas','cmqra7suf000h9mvbnl2mhb25','BOT','🔄 Vamos a mover este turno:\n\n🎾 miércoles 15/07 · 22:30–00:00 · Cancha 2\n\nNo lo cancelo: te lo paso a otro horario y *la seña que pagaste sigue valiendo*. ¿Para qué día lo querés?','2026-07-14 02:34:32.656'),('cmrk1m4g40000knvb41ubijc1','cmqra7suf000h9mvbnl2mhb25','USER','Quiero pasarlo a jueves','2026-07-14 02:39:28.516'),('cmrk1m4h00001knvbcrx3q4hp','cmqra7suf000h9mvbnl2mhb25','BOT','🎾 Para el *16/07* tengo estos turnos libres:\n\n*Cancha 1*\n• 09:00–10:30\n• 10:30–12:00\n• 12:00–13:30\n• 13:30–15:00\n• 15:00–16:30\n• 16:30–18:00\n• 18:00–19:30\n• 19:30–21:00\n• 21:00–22:30\n• 22:30–00:00\n\n*Cancha 2*\n• 09:00–10:30\n• 10:30–12:00\n• 12:00–13:30\n• 13:30–15:00\n• 15:00–16:30\n• 16:30–18:00\n• 18:00–19:30\n• 19:30–21:00\n• 21:00–22:30\n• 22:30–00:00\n\nDecime el horario que querés (ej: *las 18*) y te asigno la cancha. 🎾','2026-07-14 02:39:28.548'),('cmrk1mgpa0002knvb4muqiqk4','cmqra7suf000h9mvbnl2mhb25','USER','12:00','2026-07-14 02:39:44.398'),('cmrk1mgpm0003knvbjc1uu5gf','cmqra7suf000h9mvbnl2mhb25','BOT','🔄 *¿Confirmo el cambio?*\n\nAntes: miércoles 15/07 · 22:30–00:00 · Cancha 2\nAhora: 16/07 · 12:00–13:30 · Cancha 2\n\nMismo precio y tu seña sigue aplicada. ¿Lo muevo?','2026-07-14 02:39:44.410'),('cmrk1mlwc0004knvba5e63r6k','cmqra7suf000h9mvbnl2mhb25','USER','si','2026-07-14 02:39:51.132'),('cmrk1mlxa0006knvb0yzxyy1q','cmqra7suf000h9mvbnl2mhb25','BOT','✅ *¡Listo, lo moví!*\n\n📅 16/07 · 12:00–13:30\n🎾 Cancha 2\n\n¡Nos vemos en la cancha! 🎾','2026-07-14 02:39:51.166'),('cmrk2c2iq000diavb5jt80hjt','cmrk2c2io000ciavbhkslmlv4','USER','quiero reservar mañana a las diez de la mañana','2026-07-14 02:59:39.074'),('cmrk2c3j9000eiavbjlnsegct','cmrk2c2io000ciavbhkslmlv4','BOT','👤 ¡Genial! ¿A nombre de quién pongo la reserva?','2026-07-14 02:59:40.389'),('cmrk2cddi000fiavba7dfz8ev','cmrk2c2io000ciavbhkslmlv4','USER','cualquiera','2026-07-14 02:59:53.142'),('cmrk2cddp000giavbe2hafm82','cmrk2c2io000ciavbhkslmlv4','BOT','🎾 Para el *14/07* a las *10:30–12:00* tengo libre:\n\n• Cancha 1 — $40.000\n• Cancha 2 — $12.000\n\n¿Cuál preferís? O decime *\"cualquiera\"* y te asigno una. 🎾','2026-07-14 02:59:53.149'),('cmrk2cngu000hiavbhl6t55aj','cmrk2c2io000ciavbhkslmlv4','USER','confirmo','2026-07-14 03:00:06.222'),('cmrk2colo000jiavb4yvwxu1q','cmrk2c2io000ciavbhkslmlv4','BOT','🎾 Para el *14/07* a las *10:30–12:00* tengo libre:\n\n• Cancha 1 — $40.000\n• Cancha 2 — $12.000\n\n¿Cuál preferís? O decime *\"cualquiera\"* y te asigno una. 🎾','2026-07-14 03:00:07.692'),('cmrk2d3ye000kiavb2oyavtrc','cmrk2c2io000ciavbhkslmlv4','USER','cancha 2','2026-07-14 03:00:27.590'),('cmrk2d3yj000liavbh6mlgiy0','cmrk2c2io000ciavbhkslmlv4','BOT','📋 *Resumen de tu reserva:*\n\n📅 Fecha: 14/07\n🎾 Cancha: Cancha 2\n⏰ Horario: 10:30–12:00\n💰 Precio: $12.000\n👤 Nombre: Cualquiera\n\n👀 Revisá que esté todo bien. Si coincide, confirmame y te lo dejo reservado 🎾','2026-07-14 03:00:27.595'),('cmrk2desy000miavby4bhp8bj','cmrk2c2io000ciavbhkslmlv4','USER','si confirmo','2026-07-14 03:00:41.650'),('cmrk2detg000piavbnq4kkah3','cmrk2c2io000ciavbhkslmlv4','BOT','⏳ *Reserva pre-confirmada — falta el pago*\n\n📅 14/07 · 10:30–12:00\n🎾 Cancha 2\n\nPara confirmar el turno, transferí la seña para reservar:\n\n💰 Importe: *$3.000*\n🏦 Alias: *lucasquaroni*\n👤 Titular: *Club Demo Pádel*\n\n⚠️ Importante: transferí *desde tu propia cuenta* de MercadoPago (a nombre del DNI *38123456*). Así confirmo tu pago solo; si transferís desde otra cuenta, lo reviso a mano.\n\n⏰ Tenés *30 minutos*. Cuando se acredite te aviso por acá; si no llega a tiempo, el turno queda libre.','2026-07-14 03:00:41.668');
/*!40000 ALTER TABLE `ConversationMessage` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `ConversationSession`
--

DROP TABLE IF EXISTS `ConversationSession`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `ConversationSession` (
  `id` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `waId` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `clubId` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `state` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'IDLE',
  `context` json NOT NULL,
  `expiresAt` datetime(3) NOT NULL,
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` datetime(3) NOT NULL,
  `mode` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'AI',
  `playerName` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `needsAdvisor` tinyint(1) NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  UNIQUE KEY `ConversationSession_waId_clubId_key` (`waId`,`clubId`),
  KEY `ConversationSession_clubId_idx` (`clubId`),
  CONSTRAINT `ConversationSession_clubId_fkey` FOREIGN KEY (`clubId`) REFERENCES `Club` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `ConversationSession`
--

LOCK TABLES `ConversationSession` WRITE;
/*!40000 ALTER TABLE `ConversationSession` DISABLE KEYS */;
INSERT INTO `ConversationSession` VALUES ('cmqr7pvw200003fvbg2sx3xw0','5491199999999','cmqq1kmvm0000fsvbxvn7vzvb','MENU','{\"history\": [{\"role\": \"user\", \"content\": \"Hola\"}, {\"role\": \"assistant\", \"content\": \"👋 ¡Hola! Soy el asistente del club, encantado 🎾 Estoy para darte una mano con tus turnos.\\n\\nContame qué necesitás y lo resolvemos 🎾 Puedo reservar un turno, mostrarte tus reservas o cancelar una. Escribime con tus palabras, como por ejemplo *\\\"un turno para el sábado a la tarde\\\"*.\"}]}','2026-06-23 22:55:02.649','2026-06-23 22:25:02.642','2026-06-24 01:07:22.029','HUMAN',NULL,0),('cmqra7suf000h9mvbnl2mhb25','5493416956364','cmqq1kmvm0000fsvbxvn7vzvb','MENU','{\"history\": [{\"role\": \"user\", \"content\": \"turno:cmrk0n6da000ewwvbql771s63\"}, {\"role\": \"assistant\", \"content\": \"🔄 Vamos a mover este turno:\\n\\n🎾 miércoles 15/07 · 22:30–00:00 · Cancha 2\\n\\nNo lo cancelo: te lo paso a otro horario y *la seña que pagaste sigue valiendo*. ¿Para qué día lo querés?\"}, {\"role\": \"user\", \"content\": \"Quiero pasarlo a jueves\"}, {\"role\": \"assistant\", \"content\": \"🎾 Para el *16/07* tengo estos turnos libres:\\n\\n*Cancha 1*\\n• 09:00–10:30\\n• 10:30–12:00\\n• 12:00–13:30\\n• 13:30–15:00\\n• 15:00–16:30\\n• 16:30–18:00\\n• 18:00–19:30\\n• 19:30–21:00\\n• 21:00–22:30\\n• 22:30–00:00\\n\\n*Cancha 2*\\n• 09:00–10:30\\n• 10:30–12:00\\n• 12:00–13:30\\n• 13:30–15:00\\n• 15:00–16:30\\n• 16:30–18:00\\n• 18:00–19:30\\n• 19:30–21:00\\n• 21:00–22:30\\n• 22:30–00:00\\n\\nDecime el horario que querés (ej: *las 18*) y te asigno la cancha. 🎾\"}, {\"role\": \"user\", \"content\": \"12:00\"}, {\"role\": \"assistant\", \"content\": \"🔄 *¿Confirmo el cambio?*\\n\\nAntes: miércoles 15/07 · 22:30–00:00 · Cancha 2\\nAhora: 16/07 · 12:00–13:30 · Cancha 2\\n\\nMismo precio y tu seña sigue aplicada. ¿Lo muevo?\"}, {\"role\": \"user\", \"content\": \"si\"}, {\"role\": \"assistant\", \"content\": \"✅ *¡Listo, lo moví!*\\n\\n📅 16/07 · 12:00–13:30\\n🎾 Cancha 2\\n\\n¡Nos vemos en la cancha! 🎾\"}]}','2026-07-14 03:09:51.162','2026-06-23 23:34:57.735','2026-07-14 02:39:51.164','AI',NULL,0),('cmrk0pwbp000gwwvb3b3usffo','5493412776893','cmqq1kmvm0000fsvbxvn7vzvb','MENU','{\"history\": [{\"role\": \"user\", \"content\": \"Devolverme la plata\"}, {\"role\": \"assistant\", \"content\": \"Lamentablemente, no puedo gestionar devoluciones ni pagos. Te recomiendo que hables directamente con el club para resolverlo. Si necesitas ayuda con otra cosa, ¡aquí estoy!\"}, {\"role\": \"user\", \"content\": \"Quiero reservar otro turno\"}, {\"role\": \"assistant\", \"content\": \"¡Perfecto! ¿Para qué fecha y horario te gustaría reservar el nuevo turno? 🎾\"}, {\"role\": \"user\", \"content\": \"18hs\"}, {\"role\": \"assistant\", \"content\": \"📋 *Resumen de tu reserva:*\\n\\n📅 Fecha: 14/07\\n🎾 Cancha: Cancha 1\\n⏰ Horario: 18:00–19:30\\n💰 Precio: $40.000\\n👤 Nombre: Mateas Donarumma\\n\\n👀 Revisá que esté todo bien. Si coincide, confirmame y te lo dejo reservado 🎾\"}, {\"role\": \"user\", \"content\": \"si\"}, {\"role\": \"assistant\", \"content\": \"⏳ *Reserva pre-confirmada — falta el pago*\\n\\n📅 14/07 · 18:00–19:30\\n🎾 Cancha 1\\n\\nPara confirmar el turno, transferí la seña para reservar:\\n\\n💰 Importe: *$10.000*\\n🏦 Alias: *lucasquaroni*\\n👤 Titular: *Club Demo Pádel*\\n\\n⚠️ Importante: transferí *desde tu propia cuenta* de MercadoPago (a nombre del DNI *44428719*). Así confirmo tu pago solo; si transferís desde otra cuenta, lo reviso a mano.\\n\\n⏰ Tenés *30 minutos*. Cuando se acredite te aviso por acá; si no llega a tiempo, el turno queda libre.\"}], \"playerDni\": \"44428719\", \"playerName\": \"Mateas Donarumma\"}','2026-07-14 02:55:51.571','2026-07-14 02:14:24.997','2026-07-14 02:30:40.173','AI','Mateas Donarumma',0),('cmrk2c2io000ciavbhkslmlv4','5493410000001','cmqq1kmvm0000fsvbxvn7vzvb','MENU','{\"history\": [{\"role\": \"user\", \"content\": \"cualquiera\"}, {\"role\": \"assistant\", \"content\": \"🎾 Para el *14/07* a las *10:30–12:00* tengo libre:\\n\\n• Cancha 1 — $40.000\\n• Cancha 2 — $12.000\\n\\n¿Cuál preferís? O decime *\\\"cualquiera\\\"* y te asigno una. 🎾\"}, {\"role\": \"user\", \"content\": \"confirmo\"}, {\"role\": \"assistant\", \"content\": \"🎾 Para el *14/07* a las *10:30–12:00* tengo libre:\\n\\n• Cancha 1 — $40.000\\n• Cancha 2 — $12.000\\n\\n¿Cuál preferís? O decime *\\\"cualquiera\\\"* y te asigno una. 🎾\"}, {\"role\": \"user\", \"content\": \"cancha 2\"}, {\"role\": \"assistant\", \"content\": \"📋 *Resumen de tu reserva:*\\n\\n📅 Fecha: 14/07\\n🎾 Cancha: Cancha 2\\n⏰ Horario: 10:30–12:00\\n💰 Precio: $12.000\\n👤 Nombre: Cualquiera\\n\\n👀 Revisá que esté todo bien. Si coincide, confirmame y te lo dejo reservado 🎾\"}, {\"role\": \"user\", \"content\": \"si confirmo\"}, {\"role\": \"assistant\", \"content\": \"⏳ *Reserva pre-confirmada — falta el pago*\\n\\n📅 14/07 · 10:30–12:00\\n🎾 Cancha 2\\n\\nPara confirmar el turno, transferí la seña para reservar:\\n\\n💰 Importe: *$3.000*\\n🏦 Alias: *lucasquaroni*\\n👤 Titular: *Club Demo Pádel*\\n\\n⚠️ Importante: transferí *desde tu propia cuenta* de MercadoPago (a nombre del DNI *38123456*). Así confirmo tu pago solo; si transferís desde otra cuenta, lo reviso a mano.\\n\\n⏰ Tenés *30 minutos*. Cuando se acredite te aviso por acá; si no llega a tiempo, el turno queda libre.\"}], \"playerDni\": \"38123456\", \"playerName\": \"Cualquiera\"}','2026-07-14 03:30:41.666','2026-07-14 02:59:39.072','2026-07-14 03:00:41.666','AI','Cualquiera',0);
/*!40000 ALTER TABLE `ConversationSession` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `Court`
--

DROP TABLE IF EXISTS `Court`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `Court` (
  `id` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `clubId` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` datetime(3) NOT NULL,
  `priceCents` int NOT NULL DEFAULT '0',
  `closeTime` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '00:00',
  `openTime` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '09:00',
  `courtType` enum('INDOOR','OUTDOOR') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'INDOOR',
  `slotDurationMinutes` int NOT NULL DEFAULT '90',
  `weeklyHours` json DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `Court_clubId_idx` (`clubId`),
  CONSTRAINT `Court_clubId_fkey` FOREIGN KEY (`clubId`) REFERENCES `Club` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `Court`
--

LOCK TABLES `Court` WRITE;
/*!40000 ALTER TABLE `Court` DISABLE KEYS */;
INSERT INTO `Court` VALUES ('cmqq1kn1m0001fsvb0ro5yjtr','Cancha 1','cmqq1kmvm0000fsvbxvn7vzvb','2026-06-23 02:45:14.026','2026-06-24 01:00:29.947',4000000,'00:00','09:00','INDOOR',90,NULL),('cmqq1kn1m0002fsvbacjqlsso','Cancha 2','cmqq1kmvm0000fsvbxvn7vzvb','2026-06-23 02:45:14.026','2026-06-23 02:45:14.026',1200000,'00:00','09:00','INDOOR',90,NULL);
/*!40000 ALTER TABLE `Court` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `CourtPriceRule`
--

DROP TABLE IF EXISTS `CourtPriceRule`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `CourtPriceRule` (
  `id` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `clubId` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `courtId` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `dayOfWeek` int DEFAULT NULL,
  `startTime` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `priceCents` int NOT NULL,
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `CourtPriceRule_courtId_dayOfWeek_startTime_key` (`courtId`,`dayOfWeek`,`startTime`),
  KEY `CourtPriceRule_clubId_idx` (`clubId`),
  KEY `CourtPriceRule_courtId_idx` (`courtId`),
  CONSTRAINT `CourtPriceRule_clubId_fkey` FOREIGN KEY (`clubId`) REFERENCES `Club` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `CourtPriceRule_courtId_fkey` FOREIGN KEY (`courtId`) REFERENCES `Court` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `CourtPriceRule`
--

LOCK TABLES `CourtPriceRule` WRITE;
/*!40000 ALTER TABLE `CourtPriceRule` DISABLE KEYS */;
/*!40000 ALTER TABLE `CourtPriceRule` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `DeviceToken`
--

DROP TABLE IF EXISTS `DeviceToken`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `DeviceToken` (
  `id` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `userId` int NOT NULL,
  `clubId` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `token` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `platform` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `DeviceToken_token_key` (`token`),
  KEY `DeviceToken_clubId_idx` (`clubId`),
  KEY `DeviceToken_userId_idx` (`userId`),
  CONSTRAINT `DeviceToken_clubId_fkey` FOREIGN KEY (`clubId`) REFERENCES `Club` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `DeviceToken_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `DeviceToken`
--

LOCK TABLES `DeviceToken` WRITE;
/*!40000 ALTER TABLE `DeviceToken` DISABLE KEYS */;
/*!40000 ALTER TABLE `DeviceToken` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `LlmUsageDaily`
--

DROP TABLE IF EXISTS `LlmUsageDaily`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `LlmUsageDaily` (
  `id` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `clubId` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `dateKey` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `calls` int NOT NULL DEFAULT '0',
  `inputTokens` int NOT NULL DEFAULT '0',
  `outputTokens` int NOT NULL DEFAULT '0',
  `costMicroUsd` int NOT NULL DEFAULT '0',
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `LlmUsageDaily_clubId_dateKey_key` (`clubId`,`dateKey`),
  KEY `LlmUsageDaily_clubId_idx` (`clubId`),
  KEY `LlmUsageDaily_dateKey_idx` (`dateKey`),
  CONSTRAINT `LlmUsageDaily_clubId_fkey` FOREIGN KEY (`clubId`) REFERENCES `Club` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `LlmUsageDaily`
--

LOCK TABLES `LlmUsageDaily` WRITE;
/*!40000 ALTER TABLE `LlmUsageDaily` DISABLE KEYS */;
INSERT INTO `LlmUsageDaily` VALUES ('cmrjzva4500029avbss5oro9g','cmqq1kmvm0000fsvbxvn7vzvb','2026-07-13',13,17415,401,2853,'2026-07-14 01:50:36.533','2026-07-14 02:59:40.372'),('cmrk2col4000iiavbpmyzf6gs','cmqq1kmvm0000fsvbxvn7vzvb','2026-07-14',1,1338,33,221,'2026-07-14 03:00:07.672','2026-07-14 03:00:07.672');
/*!40000 ALTER TABLE `LlmUsageDaily` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `PaymentReceipt`
--

DROP TABLE IF EXISTS `PaymentReceipt`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `PaymentReceipt` (
  `id` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `bookingId` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `clubId` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `storageKey` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `url` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `mimeType` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `sizeBytes` int NOT NULL,
  `waMediaId` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `PaymentReceipt_bookingId_idx` (`bookingId`),
  KEY `PaymentReceipt_clubId_idx` (`clubId`),
  CONSTRAINT `PaymentReceipt_bookingId_fkey` FOREIGN KEY (`bookingId`) REFERENCES `Booking` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `PaymentReceipt_clubId_fkey` FOREIGN KEY (`clubId`) REFERENCES `Club` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `PaymentReceipt`
--

LOCK TABLES `PaymentReceipt` WRITE;
/*!40000 ALTER TABLE `PaymentReceipt` DISABLE KEYS */;
/*!40000 ALTER TABLE `PaymentReceipt` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `PlatformAdmin`
--

DROP TABLE IF EXISTS `PlatformAdmin`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `PlatformAdmin` (
  `id` int NOT NULL AUTO_INCREMENT,
  `email` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `password` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `isActive` tinyint(1) NOT NULL DEFAULT '1',
  `lastLoginAt` datetime(3) DEFAULT NULL,
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `PlatformAdmin_email_key` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `PlatformAdmin`
--

LOCK TABLES `PlatformAdmin` WRITE;
/*!40000 ALTER TABLE `PlatformAdmin` DISABLE KEYS */;
/*!40000 ALTER TABLE `PlatformAdmin` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `Player`
--

DROP TABLE IF EXISTS `Player`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `Player` (
  `id` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `clubId` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `phone` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `dni` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `payerMpUserId` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `noShowCount` int NOT NULL DEFAULT '0',
  `creditCents` int NOT NULL DEFAULT '0',
  `isBlocked` tinyint(1) NOT NULL DEFAULT '0',
  `notes` text COLLATE utf8mb4_unicode_ci,
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `Player_clubId_phone_key` (`clubId`,`phone`),
  KEY `Player_clubId_idx` (`clubId`),
  CONSTRAINT `Player_clubId_fkey` FOREIGN KEY (`clubId`) REFERENCES `Club` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `Player`
--

LOCK TABLES `Player` WRITE;
/*!40000 ALTER TABLE `Player` DISABLE KEYS */;
INSERT INTO `Player` VALUES ('cmrjzy6th000d9avbplctxpy3','cmqq1kmvm0000fsvbxvn7vzvb','5493410000001','Cualquiera','38123456',NULL,0,0,0,NULL,'2026-07-14 01:52:52.229','2026-07-14 03:00:41.657'),('cmrk0n6d1000cwwvb6lwguk67','cmqq1kmvm0000fsvbxvn7vzvb','5493416956364','Lucas Quaroni','44765283','206515141',0,0,0,NULL,'2026-07-14 02:12:18.037','2026-07-14 02:13:01.412'),('cmrk0rqdm000ywwvbrivp8v0q','cmqq1kmvm0000fsvbxvn7vzvb','5493412776893','Mateas Donarumma','44428719','1296833279',0,0,0,NULL,'2026-07-14 02:15:50.602','2026-07-14 02:30:55.485');
/*!40000 ALTER TABLE `Player` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `ProcessedWebhookMessage`
--

DROP TABLE IF EXISTS `ProcessedWebhookMessage`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `ProcessedWebhookMessage` (
  `id` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `ProcessedWebhookMessage_createdAt_idx` (`createdAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `ProcessedWebhookMessage`
--

LOCK TABLES `ProcessedWebhookMessage` WRITE;
/*!40000 ALTER TABLE `ProcessedWebhookMessage` DISABLE KEYS */;
INSERT INTO `ProcessedWebhookMessage` VALUES ('wamid.test.1783993833719539000','2026-07-14 01:50:33.773'),('wamid.test.1783993902184884000','2026-07-14 01:51:42.222'),('wamid.test.1783993918064767000','2026-07-14 01:51:58.104'),('wamid.test.1783993935870188000','2026-07-14 01:52:15.909'),('wamid.test.1783993954074732000','2026-07-14 01:52:34.115'),('wamid.test.1783993972170216000','2026-07-14 01:52:52.218'),('wamid.HBgNNTQ5MzQxNjk1NjM2NBUCABIYFDNCMzAxQzAxNTQyMUI0NzE4M0Y2AA==','2026-07-14 02:05:55.435'),('wamid.HBgNNTQ5MzQxNjk1NjM2NBUCABIYFDNCRjhEM0NGMjRDOTJBMzlGQkJFAA==','2026-07-14 02:10:34.874'),('wamid.HBgNNTQ5MzQxNjk1NjM2NBUCABIYFDNCNTY4MEIyNEU5Nzc5Q0NFOTFEAA==','2026-07-14 02:10:58.507'),('wamid.HBgNNTQ5MzQxNjk1NjM2NBUCABIYFDNCQjg2NzgwQTQ0RDRFQzg1QUMxAA==','2026-07-14 02:11:08.115'),('wamid.HBgNNTQ5MzQxNjk1NjM2NBUCABIYFDNCM0I0MDg0M0I3MjU4QTMwQ0I4AA==','2026-07-14 02:11:16.641'),('wamid.HBgNNTQ5MzQxNjk1NjM2NBUCABIYFDNCRjA1QzFBRDcxODQ2NzY3RDFFAA==','2026-07-14 02:11:40.361'),('wamid.HBgNNTQ5MzQxNjk1NjM2NBUCABIYFDNCQTJCQjk4QjVGRDE1QkVGQjUyAA==','2026-07-14 02:12:18.021'),('wamid.HBgNNTQ5MzQxMjc3Njg5MxUCABIYFDNBRTczOUU0QTMwOEU1QTBBNjJDAA==','2026-07-14 02:14:24.992'),('wamid.HBgNNTQ5MzQxMjc3Njg5MxUCABIYFDNBODQ5QzJDM0NERUVCRENGNUQyAA==','2026-07-14 02:14:34.327'),('wamid.HBgNNTQ5MzQxMjc3Njg5MxUCABIYFDNBRDJEN0E3QkU0OEQzNTFDQTQ4AA==','2026-07-14 02:14:42.155'),('wamid.HBgNNTQ5MzQxMjc3Njg5MxUCABIYFDNBNjUwRDg4QkU4NEI5QzU1N0UwAA==','2026-07-14 02:14:54.568'),('wamid.HBgNNTQ5MzQxMjc3Njg5MxUCABIYFDNBRDlFMEI4NEFBNzA3QkUzOTcyAA==','2026-07-14 02:15:06.859'),('wamid.HBgNNTQ5MzQxMjc3Njg5MxUCABIYFDNBQzA3Q0VERjE2QTE2QUM0NEFEAA==','2026-07-14 02:15:22.692'),('wamid.HBgNNTQ5MzQxMjc3Njg5MxUCABIYFDNBRjJENkRFOTJFODYwNjI3MUZBAA==','2026-07-14 02:15:28.863'),('wamid.HBgNNTQ5MzQxMjc3Njg5MxUCABIYFDNBRDExMTk3OTY2NUZCNzZCODZFAA==','2026-07-14 02:15:36.554'),('wamid.HBgNNTQ5MzQxMjc3Njg5MxUCABIYFDNBNjA0RkFDQjczNDI4QzkxNzJCAA==','2026-07-14 02:15:50.585'),('wamid.HBgNNTQ5MzQxMjc3Njg5MxUCABIYFDNBN0I1RDQ3RjUyRDJCNDdDREQzAA==','2026-07-14 02:17:06.747'),('wamid.HBgNNTQ5MzQxNjk1NjM2NBUCABIYFDNCQjNCNTZDNjE5M0U2NDlDQUMxAA==','2026-07-14 02:21:16.604'),('wamid.HBgNNTQ5MzQxNjk1NjM2NBUCABIYFDNCMTNBMDE3MDk3RjBERTE0QjMzAA==','2026-07-14 02:21:22.063'),('wamid.HBgNNTQ5MzQxNjk1NjM2NBUCABIYFDNCMDIwMkUxQkIwRDZBN0NEQjg0AA==','2026-07-14 02:22:12.011'),('wamid.HBgNNTQ5MzQxNjk1NjM2NBUCABIYFDNCMDhGNjVCRDAyRkI1MTdEN0IwAA==','2026-07-14 02:22:14.927'),('wamid.HBgNNTQ5MzQxMjc3Njg5MxUCABIYFDNBQkI3RThENDJEOEQ4M0MwQ0M3AA==','2026-07-14 02:25:15.511'),('wamid.HBgNNTQ5MzQxMjc3Njg5MxUCABIYFDNBNzk3MEE4RDgxRUI2RTg4MTQ5AA==','2026-07-14 02:25:37.792'),('wamid.HBgNNTQ5MzQxMjc3Njg5MxUCABIYFDNBMUZBRUM2MkVFOTJDMEUxMDVGAA==','2026-07-14 02:25:51.530'),('wamid.HBgNNTQ5MzQxNjk1NjM2NBUCABIYFjNFQjBGQzUzQzMzOTczRkFFQzkzNjcA','2026-07-14 02:34:10.116'),('wamid.HBgNNTQ5MzQxNjk1NjM2NBUCABIYFjNFQjA2MUJCQ0UxOTc4NTA1RUUyNjIA','2026-07-14 02:34:27.628'),('wamid.HBgNNTQ5MzQxNjk1NjM2NBUCABIYFjNFQjA4OEQzODE0QThFRkIzMzExNjUA','2026-07-14 02:34:32.627'),('wamid.HBgNNTQ5MzQxNjk1NjM2NBUCABIYFjNFQjA5NUYyNjYwQUVFMzlDOEFFNTcA','2026-07-14 02:39:28.502'),('wamid.HBgNNTQ5MzQxNjk1NjM2NBUCABIYFjNFQjA4MTY0MUEwQ0U0RjZGN0RCRUMA','2026-07-14 02:39:44.389'),('wamid.HBgNNTQ5MzQxNjk1NjM2NBUCABIYFjNFQjAwOEQ0RUFBMDk2MUZEOThGRDgA','2026-07-14 02:39:51.123'),('wamid.test.1783996997235042000','2026-07-14 02:43:17.306'),('wamid.test.1783997020055234000','2026-07-14 02:43:40.093'),('wamid.test.1783997068298092000','2026-07-14 02:44:28.364'),('wamid.test.1783997095431668000','2026-07-14 02:44:55.485'),('wamid.test.1783997115837427000','2026-07-14 02:45:15.884'),('wamid.test.1783997138112920000','2026-07-14 02:45:38.160'),('wamid.test.1783997151175725000','2026-07-14 02:45:51.225'),('wamid.test.1783997164255007000','2026-07-14 02:46:04.311'),('wamid.test.1783997212296789000','2026-07-14 02:46:52.335'),('wamid.test.1783997227358517000','2026-07-14 02:47:07.404'),('wamid.test.1783997285636378000','2026-07-14 02:48:05.675'),('wamid.test.1783997300691028000','2026-07-14 02:48:20.734'),('wamid.test.1783997344670818000','2026-07-14 02:49:04.709'),('wamid.test.1783997408479869000','2026-07-14 02:50:08.519'),('wamid.test.1783997432759765000','2026-07-14 02:50:32.798'),('wamid.test.1783997601544843000','2026-07-14 02:53:21.604'),('wamid.test.1783997625532218000','2026-07-14 02:53:45.569'),('wamid.test.1783997795847643000','2026-07-14 02:56:35.896'),('wamid.test.1783997810918023000','2026-07-14 02:56:50.965'),('wamid.test.1783997834617903000','2026-07-14 02:57:14.656'),('wamid.test.1783997849678365000','2026-07-14 02:57:29.723'),('wamid.test.1783997871698999000','2026-07-14 02:57:51.733'),('wamid.test.1783997979025959000','2026-07-14 02:59:39.068'),('wamid.test.1783997993090897000','2026-07-14 02:59:53.138'),('wamid.test.1783998006165200000','2026-07-14 03:00:06.218'),('wamid.test.1783998027549672000','2026-07-14 03:00:27.587'),('wamid.test.1783998041606018000','2026-07-14 03:00:41.645');
/*!40000 ALTER TABLE `ProcessedWebhookMessage` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `Product`
--

DROP TABLE IF EXISTS `Product`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `Product` (
  `id` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `clubId` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `priceCents` int NOT NULL,
  `category` enum('PELOTA','BEBIDA','SNACK','ACCESORIO','OTRO') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'OTRO',
  `isActive` tinyint(1) NOT NULL DEFAULT '1',
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `Product_clubId_idx` (`clubId`),
  CONSTRAINT `Product_clubId_fkey` FOREIGN KEY (`clubId`) REFERENCES `Club` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `Product`
--

LOCK TABLES `Product` WRITE;
/*!40000 ALTER TABLE `Product` DISABLE KEYS */;
/*!40000 ALTER TABLE `Product` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `RecurringBooking`
--

DROP TABLE IF EXISTS `RecurringBooking`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `RecurringBooking` (
  `id` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `clubId` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `courtId` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `dayOfWeek` int NOT NULL,
  `slotStart` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `slotEnd` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `playerName` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `playerPhone` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `priceCents` int NOT NULL,
  `notes` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `isActive` tinyint(1) NOT NULL DEFAULT '1',
  `createdByUserId` int NOT NULL,
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` datetime(3) NOT NULL,
  `untilDate` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `RecurringBooking_clubId_idx` (`clubId`),
  KEY `RecurringBooking_courtId_idx` (`courtId`),
  KEY `RecurringBooking_clubId_courtId_dayOfWeek_idx` (`clubId`,`courtId`,`dayOfWeek`),
  KEY `RecurringBooking_createdByUserId_fkey` (`createdByUserId`),
  CONSTRAINT `RecurringBooking_clubId_fkey` FOREIGN KEY (`clubId`) REFERENCES `Club` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `RecurringBooking_courtId_fkey` FOREIGN KEY (`courtId`) REFERENCES `Court` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `RecurringBooking_createdByUserId_fkey` FOREIGN KEY (`createdByUserId`) REFERENCES `User` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `RecurringBooking`
--

LOCK TABLES `RecurringBooking` WRITE;
/*!40000 ALTER TABLE `RecurringBooking` DISABLE KEYS */;
/*!40000 ALTER TABLE `RecurringBooking` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `ScheduledPriceAdjustment`
--

DROP TABLE IF EXISTS `ScheduledPriceAdjustment`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `ScheduledPriceAdjustment` (
  `id` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `clubId` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `percent` double NOT NULL,
  `effectiveDateKey` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `appliedAt` datetime(3) DEFAULT NULL,
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `ScheduledPriceAdjustment_clubId_idx` (`clubId`),
  KEY `ScheduledPriceAdjustment_appliedAt_effectiveDateKey_idx` (`appliedAt`,`effectiveDateKey`),
  CONSTRAINT `ScheduledPriceAdjustment_clubId_fkey` FOREIGN KEY (`clubId`) REFERENCES `Club` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `ScheduledPriceAdjustment`
--

LOCK TABLES `ScheduledPriceAdjustment` WRITE;
/*!40000 ALTER TABLE `ScheduledPriceAdjustment` DISABLE KEYS */;
/*!40000 ALTER TABLE `ScheduledPriceAdjustment` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `Slot`
--

DROP TABLE IF EXISTS `Slot`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `Slot` (
  `id` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `courtId` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `clubId` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `startsAt` datetime(3) NOT NULL,
  `endsAt` datetime(3) NOT NULL,
  `priceCents` int NOT NULL,
  `status` enum('AVAILABLE','BOOKED','BLOCKED') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'AVAILABLE',
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `Slot_courtId_startsAt_key` (`courtId`,`startsAt`),
  KEY `Slot_clubId_idx` (`clubId`),
  KEY `Slot_clubId_startsAt_idx` (`clubId`,`startsAt`),
  CONSTRAINT `Slot_clubId_fkey` FOREIGN KEY (`clubId`) REFERENCES `Club` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `Slot_courtId_fkey` FOREIGN KEY (`courtId`) REFERENCES `Court` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `Slot`
--

LOCK TABLES `Slot` WRITE;
/*!40000 ALTER TABLE `Slot` DISABLE KEYS */;
INSERT INTO `Slot` VALUES ('cmqr9cgy000019mvb48q0mtg5','cmqq1kn1m0001fsvb0ro5yjtr','cmqq1kmvm0000fsvbxvn7vzvb','2026-06-29 12:00:00.000','2026-06-29 13:30:00.000',1200000,'AVAILABLE','2026-06-23 23:10:35.976','2026-06-24 00:59:36.875'),('cmqr9cgy200029mvbr3coyzxw','cmqq1kn1m0001fsvb0ro5yjtr','cmqq1kmvm0000fsvbxvn7vzvb','2026-07-06 12:00:00.000','2026-07-06 13:30:00.000',1200000,'AVAILABLE','2026-06-23 23:10:35.978','2026-06-24 00:59:36.112'),('cmqr9cgy300039mvbmq1leox1','cmqq1kn1m0001fsvb0ro5yjtr','cmqq1kmvm0000fsvbxvn7vzvb','2026-07-13 12:00:00.000','2026-07-13 13:30:00.000',1200000,'AVAILABLE','2026-06-23 23:10:35.979','2026-06-24 00:59:35.275'),('cmqr9cgy300049mvbvpmyfcrp','cmqq1kn1m0001fsvb0ro5yjtr','cmqq1kmvm0000fsvbxvn7vzvb','2026-07-20 12:00:00.000','2026-07-20 13:30:00.000',1200000,'AVAILABLE','2026-06-23 23:10:35.979','2026-06-24 00:59:34.527'),('cmqr9cgy400059mvb7ig994ck','cmqq1kn1m0001fsvb0ro5yjtr','cmqq1kmvm0000fsvbxvn7vzvb','2026-07-27 12:00:00.000','2026-07-27 13:30:00.000',1200000,'AVAILABLE','2026-06-23 23:10:35.980','2026-06-24 00:59:33.693'),('cmqr9cgy500069mvbd33gtkg6','cmqq1kn1m0001fsvb0ro5yjtr','cmqq1kmvm0000fsvbxvn7vzvb','2026-08-03 12:00:00.000','2026-08-03 13:30:00.000',1200000,'AVAILABLE','2026-06-23 23:10:35.981','2026-06-24 00:59:32.660'),('cmqr9cgy500079mvbiaakp569','cmqq1kn1m0001fsvb0ro5yjtr','cmqq1kmvm0000fsvbxvn7vzvb','2026-08-10 12:00:00.000','2026-08-10 13:30:00.000',1200000,'AVAILABLE','2026-06-23 23:10:35.981','2026-06-24 00:59:30.961'),('cmqr9cgy600089mvbrvnh1wpb','cmqq1kn1m0001fsvb0ro5yjtr','cmqq1kmvm0000fsvbxvn7vzvb','2026-08-17 12:00:00.000','2026-08-17 13:30:00.000',1200000,'AVAILABLE','2026-06-23 23:10:35.982','2026-06-24 00:59:29.686'),('cmqrae2lc000hplvbev9rnpyl','cmqq1kn1m0001fsvb0ro5yjtr','cmqq1kmvm0000fsvbxvn7vzvb','2026-06-25 01:30:00.000','2026-06-25 03:00:00.000',1200000,'AVAILABLE','2026-06-23 23:39:50.304','2026-06-24 00:19:36.123'),('cmqrej9x0000f93vby8rkljwj','cmqq1kn1m0001fsvb0ro5yjtr','cmqq1kmvm0000fsvbxvn7vzvb','2026-06-24 21:00:00.000','2026-06-24 22:30:00.000',4000000,'BOOKED','2026-06-24 01:35:51.540','2026-06-24 01:35:51.540'),('cmqrfnd04000d5svb390n6p08','cmqq1kn1m0002fsvbacjqlsso','cmqq1kmvm0000fsvbxvn7vzvb','2026-06-30 19:30:00.000','2026-06-30 21:00:00.000',1200000,'BOOKED','2026-06-24 02:07:01.780','2026-06-24 02:07:01.780'),('cmqrge6pd000bvdvb928uzbmp','cmqq1kn1m0002fsvbacjqlsso','cmqq1kmvm0000fsvbxvn7vzvb','2026-06-24 13:30:00.000','2026-06-24 15:00:00.000',1200000,'BOOKED','2026-06-24 02:27:53.329','2026-06-24 02:27:53.329'),('cmrjzy6tm000e9avbyzoaapv6','cmqq1kn1m0002fsvbacjqlsso','cmqq1kmvm0000fsvbxvn7vzvb','2026-07-14 22:30:00.000','2026-07-15 00:00:00.000',1200000,'BOOKED','2026-07-14 01:52:52.234','2026-07-14 01:52:52.234'),('cmrk0n6d7000dwwvbhw6th0lm','cmqq1kn1m0002fsvbacjqlsso','cmqq1kmvm0000fsvbxvn7vzvb','2026-07-16 01:30:00.000','2026-07-16 03:00:00.000',1200000,'AVAILABLE','2026-07-14 02:12:18.043','2026-07-14 02:39:51.153'),('cmrk0rqds000zwwvbd9yk4p9c','cmqq1kn1m0002fsvbacjqlsso','cmqq1kmvm0000fsvbxvn7vzvb','2026-07-14 21:00:00.000','2026-07-14 22:30:00.000',1200000,'BOOKED','2026-07-14 02:15:50.608','2026-07-14 02:15:50.608'),('cmrk14m320005yzvbwe7nmsqe','cmqq1kn1m0001fsvb0ro5yjtr','cmqq1kmvm0000fsvbxvn7vzvb','2026-07-14 21:00:00.000','2026-07-14 22:30:00.000',4000000,'BOOKED','2026-07-14 02:25:51.566','2026-07-14 02:25:51.566'),('cmrk1mlwp0005knvbbpigvn53','cmqq1kn1m0002fsvbacjqlsso','cmqq1kmvm0000fsvbxvn7vzvb','2026-07-16 15:00:00.000','2026-07-16 16:30:00.000',1200000,'BOOKED','2026-07-14 02:39:51.145','2026-07-14 02:39:51.145'),('cmrk1ubri0008bivbmkbz6rpp','cmqq1kn1m0002fsvbacjqlsso','cmqq1kmvm0000fsvbxvn7vzvb','2026-07-15 00:00:00.000','2026-07-15 01:30:00.000',1200000,'AVAILABLE','2026-07-14 02:45:51.246','2026-07-14 02:57:51.747'),('cmrk1yh1u000obivbz9rregto','cmqq1kn1m0001fsvb0ro5yjtr','cmqq1kmvm0000fsvbxvn7vzvb','2026-07-14 22:30:00.000','2026-07-15 00:00:00.000',4000000,'AVAILABLE','2026-07-14 02:49:04.722','2026-07-14 02:58:22.989'),('cmrk29rpb000aiavbu8qty8h7','cmqq1kn1m0002fsvbacjqlsso','cmqq1kmvm0000fsvbxvn7vzvb','2026-07-14 18:00:00.000','2026-07-14 19:30:00.000',1200000,'BOOKED','2026-07-14 02:57:51.743','2026-07-14 02:57:51.743'),('cmrk2deta000niavb5repd07n','cmqq1kn1m0002fsvbacjqlsso','cmqq1kmvm0000fsvbxvn7vzvb','2026-07-14 13:30:00.000','2026-07-14 15:00:00.000',1200000,'BOOKED','2026-07-14 03:00:41.662','2026-07-14 03:00:41.662');
/*!40000 ALTER TABLE `Slot` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `User`
--

DROP TABLE IF EXISTS `User`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `User` (
  `id` int NOT NULL AUTO_INCREMENT,
  `email` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `password` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` datetime(3) NOT NULL,
  `clubId` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `role` enum('OWNER','STAFF') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'STAFF',
  `isActive` tinyint(1) NOT NULL DEFAULT '1',
  `mustChangePassword` tinyint(1) NOT NULL DEFAULT '0',
  `lastLoginAt` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `User_email_key` (`email`),
  KEY `User_clubId_idx` (`clubId`),
  CONSTRAINT `User_clubId_fkey` FOREIGN KEY (`clubId`) REFERENCES `Club` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `User`
--

LOCK TABLES `User` WRITE;
/*!40000 ALTER TABLE `User` DISABLE KEYS */;
INSERT INTO `User` VALUES (1,'admin@clubdemo.com','$2b$12$XrzVjFli08z1IAtZX1zJJuXIOBe.0VLK4l9hbRKPo0XkAYoLmVWkG','Admin Demo','2026-06-23 02:45:14.018','2026-07-14 02:48:44.967','cmqq1kmvm0000fsvbxvn7vzvb','OWNER',1,0,'2026-07-14 02:48:44.966');
/*!40000 ALTER TABLE `User` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `WaitlistEntry`
--

DROP TABLE IF EXISTS `WaitlistEntry`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `WaitlistEntry` (
  `id` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `clubId` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `waId` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `playerName` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `dateKey` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `notifiedAt` datetime(3) DEFAULT NULL,
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `WaitlistEntry_clubId_waId_dateKey_key` (`clubId`,`waId`,`dateKey`),
  KEY `WaitlistEntry_clubId_dateKey_idx` (`clubId`,`dateKey`),
  CONSTRAINT `WaitlistEntry_clubId_fkey` FOREIGN KEY (`clubId`) REFERENCES `Club` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `WaitlistEntry`
--

LOCK TABLES `WaitlistEntry` WRITE;
/*!40000 ALTER TABLE `WaitlistEntry` DISABLE KEYS */;
/*!40000 ALTER TABLE `WaitlistEntry` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `WhatsAppLine`
--

DROP TABLE IF EXISTS `WhatsAppLine`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `WhatsAppLine` (
  `id` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `phoneNumberId` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `displayPhone` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `clubId` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `isActive` tinyint(1) NOT NULL DEFAULT '1',
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `WhatsAppLine_phoneNumberId_key` (`phoneNumberId`),
  KEY `WhatsAppLine_clubId_idx` (`clubId`),
  CONSTRAINT `WhatsAppLine_clubId_fkey` FOREIGN KEY (`clubId`) REFERENCES `Club` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `WhatsAppLine`
--

LOCK TABLES `WhatsAppLine` WRITE;
/*!40000 ALTER TABLE `WhatsAppLine` DISABLE KEYS */;
INSERT INTO `WhatsAppLine` VALUES ('cmrk0ilit000i9avbbv1jrcaf','1109940228878973','+54 9 341 692-7235','cmqq1kmvm0000fsvbxvn7vzvb',1,'2026-07-14 02:08:44.405','2026-07-14 02:08:44.405');
/*!40000 ALTER TABLE `WhatsAppLine` ENABLE KEYS */;
UNLOCK TABLES;
SET @@SESSION.SQL_LOG_BIN = @MYSQLDUMP_TEMP_LOG_BIN;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-07-20 22:20:09
