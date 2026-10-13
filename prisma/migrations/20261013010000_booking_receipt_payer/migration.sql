-- Payer identity read from the receipt photo, used to match the real MercadoPago transfer.
ALTER TABLE `Booking` ADD COLUMN `receiptPayerDni` VARCHAR(191) NULL,
    ADD COLUMN `receiptOperationRef` VARCHAR(191) NULL;
