CREATE TABLE `password_reset_tokens` (
	`tokenHash` varchar(64) NOT NULL,
	`userId` int NOT NULL,
	`expiresAt` timestamp NOT NULL,
	`usedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `password_reset_tokens_tokenHash` PRIMARY KEY(`tokenHash`)
);
--> statement-breakpoint
CREATE INDEX `password_reset_tokens_userId_idx` ON `password_reset_tokens` (`userId`);