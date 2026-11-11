-- Runs once, when the dev volume is first created. The platform tests drop this database's schema on every run.
CREATE DATABASE platform_test OWNER platform;
