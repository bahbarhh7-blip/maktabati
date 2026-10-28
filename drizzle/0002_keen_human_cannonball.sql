CREATE TABLE `user_preferences` (
	`ownerId` int NOT NULL,
	`payload` longtext NOT NULL,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `user_preferences_ownerId` PRIMARY KEY(`ownerId`)
);
