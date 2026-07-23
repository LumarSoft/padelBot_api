-- The club's bot FAQ (ordered array of { question, answer }) the bot answers general
-- club questions from. Stored as JSON, edited as a whole from the "Bot" panel section.
ALTER TABLE `Club` ADD COLUMN `botFaq` JSON NULL;
