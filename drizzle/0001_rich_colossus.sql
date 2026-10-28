CREATE TABLE `book_fairs` (
	`id` varchar(36) NOT NULL,
	`ownerId` int NOT NULL,
	`payload` longtext NOT NULL,
	`deleted` boolean NOT NULL DEFAULT false,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `book_fairs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `library_books` (
	`id` varchar(36) NOT NULL,
	`ownerId` int NOT NULL,
	`module` enum('library','surplus','borrowed','wishlist') NOT NULL,
	`payload` longtext NOT NULL,
	`deleted` boolean NOT NULL DEFAULT false,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `library_books_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `users` ADD `passwordHash` text;--> statement-breakpoint
ALTER TABLE `users` ADD CONSTRAINT `users_email_unique` UNIQUE(`email`);