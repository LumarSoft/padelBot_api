-- Credit packs are gone: a club's credits are only the ones its plan includes each month.
-- No pack was ever sold (Lumarsoft's MercadoPago credentials were never set, so a purchase
-- stopped before creating its row).

-- DropForeignKey
ALTER TABLE `CreditPackPurchase` DROP FOREIGN KEY `CreditPackPurchase_clubId_fkey`;

-- DropTable
DROP TABLE `CreditPackPurchase`;

-- AlterTable
ALTER TABLE `WhatsAppMessageDaily` DROP COLUMN `packCredits`;
