CREATE TABLE IF NOT EXISTS movies (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    code VARCHAR(32) NOT NULL UNIQUE,
    title VARCHAR(120) NOT NULL,
    director VARCHAR(120) NOT NULL,
    genre VARCHAR(60) NOT NULL,
    release_year INT UNSIGNED NOT NULL,
    rating DECIMAL(3, 1) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (rating >= 0 AND rating <= 10)
);

-- Limpieza de tabla previa si existía y creación de vista de compatibilidad
DROP TABLE IF EXISTS products;
DROP VIEW IF EXISTS products;
CREATE VIEW products AS 
    SELECT id, code AS sku, title AS name, CONCAT(genre, ' directed by ', director) AS description, rating AS price, created_at 
    FROM movies;

INSERT IGNORE INTO movies (code, title, director, genre, release_year, rating) VALUES
    ('MOV-001', 'Inception', 'Christopher Nolan', 'Sci-Fi / Action', 2010, 8.8),
    ('MOV-002', 'The Matrix', 'Lana & Lilly Wachowski', 'Sci-Fi / Action', 1999, 8.7),
    ('MOV-003', 'Interstellar', 'Christopher Nolan', 'Sci-Fi / Adventure', 2014, 8.7),
    ('MOV-004', 'Pulp Fiction', 'Quentin Tarantino', 'Crime / Drama', 1994, 8.9),
    ('MOV-005', 'The Dark Knight', 'Christopher Nolan', 'Action / Crime', 2008, 9.0),
    ('MOV-006', 'Spirited Away', 'Hayao Miyazaki', 'Animation / Adventure', 2001, 8.6),
    ('MOV-007', 'Fight Club', 'David Fincher', 'Drama', 1999, 8.8),
    ('MOV-008', 'Forrest Gump', 'Robert Zemeckis', 'Drama / Romance', 1994, 8.8),
    ('MOV-009', 'Gladiator', 'Ridley Scott', 'Action / Adventure', 2000, 8.5),
    ('MOV-010', 'Blade Runner 2049', 'Denis Villeneuve', 'Sci-Fi / Mystery', 2017, 8.0),
    ('MOV-011', 'Parasite', 'Bong Joon-ho', 'Drama / Thriller', 2019, 8.5),
    ('MOV-012', 'Oppenheimer', 'Christopher Nolan', 'Biography / Drama', 2023, 8.9);