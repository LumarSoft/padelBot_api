-- The dollar for the ops console's costs (Meta and OpenAI bill in USD), fetched daily from
-- dolarapi.com instead of an env var someone has to remember to update.

-- CreateTable
CREATE TABLE `ExchangeRate` (
    `id` VARCHAR(191) NOT NULL,
    `quote` VARCHAR(191) NOT NULL,
    `dateKey` VARCHAR(191) NOT NULL,
    `arsCents` INTEGER NOT NULL,
    `source` VARCHAR(191) NOT NULL,
    `fetchedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `ExchangeRate_quote_dateKey_key`(`quote`, `dateKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

