-- Each plan includes AI credits per month (one per AI step, counted in LlmUsageDaily.calls).
-- Going over never cuts the bot: ops gets an alert at 80% and at 100%, once per month each.
-- These columns remember the last one sent so an hourly job doesn't repeat it.

-- AlterTable
ALTER TABLE `Club` ADD COLUMN `aiCreditsAlertMonth` VARCHAR(191) NULL,
    ADD COLUMN `aiCreditsAlertPercent` INTEGER NULL;
