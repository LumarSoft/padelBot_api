-- Embedded Signup + coexistence: a line remembers its WABA, whether the number also stays on
-- the club's WhatsApp Business app, and the (encrypted) business token Meta issued for it.
ALTER TABLE `WhatsAppLine` ADD COLUMN `wabaId` VARCHAR(191) NULL,
    ADD COLUMN `coexistence` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `accessToken` TEXT NULL;

-- Temporary human takeover (owner answered from the phone): the bot resumes after this.
ALTER TABLE `ConversationSession` ADD COLUMN `humanUntil` DATETIME(3) NULL;
