-- The kiosk's point of sale reads products with a barcode scanner (it types the code and sends
-- Enter): each product can carry the code printed on it, unique per club so a scan resolves to
-- exactly one product. Optional: products without a code are still picked by hand.

-- AlterTable
ALTER TABLE `Product` ADD COLUMN `barcode` VARCHAR(64) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `Product_clubId_barcode_key` ON `Product`(`clubId`, `barcode`);
