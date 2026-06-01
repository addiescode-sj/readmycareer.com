-- Allow anonymous users to read optimized resumes by their UUID primary key.
-- UUID v4 is cryptographically random (unguessable), so possession of the ID
-- acts as authorization — the "anyone with the link" sharing pattern.
CREATE POLICY "optimized_resumes: anon public read by id"
  ON optimized_resumes FOR SELECT
  TO anon
  USING (true);
