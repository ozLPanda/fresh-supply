-- Empty collections are represented by no rows, so all existing buyers retain an empty alias list.
CREATE TABLE regular_buyer_aliases (
    buyer_id uuid NOT NULL REFERENCES regular_buyers(id) ON DELETE CASCADE,
    position integer NOT NULL CHECK (position >= 0 AND position < 50),
    alias varchar(120) NOT NULL CHECK (length(trim(alias)) > 0),
    PRIMARY KEY (buyer_id, position)
);
-- Aliases intentionally need not be unique across buyers: ambiguous matches require clarification.
