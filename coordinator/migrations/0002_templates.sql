-- Simulation templates. Existing jobs are neutron_slab jobs whose params live in the
-- thickness_cm / mfp_cm / absorb_prob columns; other templates keep their (validated,
-- defaults-filled) params as JSON in template_params.
ALTER TABLE jobs ADD COLUMN template TEXT NOT NULL DEFAULT 'neutron_slab';
ALTER TABLE jobs ADD COLUMN template_params TEXT;
