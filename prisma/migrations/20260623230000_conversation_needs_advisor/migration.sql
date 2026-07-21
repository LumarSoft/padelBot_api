-- AlterTable: flag a conversation that is waiting for a human advisor.
ALTER TABLE `ConversationSession` ADD COLUMN `needsAdvisor` BOOLEAN NOT NULL DEFAULT false;
