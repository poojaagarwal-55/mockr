provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project   = "practers"
      Env       = var.environment_name
      ManagedBy = "terraform"
      Component = "backend-migration"
    }
  }
}
