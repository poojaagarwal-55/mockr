terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.40"
    }
  }

  # Remote state. Create the bucket + DynamoDB lock table once (see README:
  # "Bootstrap"), then uncomment and `terraform init -migrate-state`.
  # backend "s3" {
  #   bucket         = "practers-tfstate"
  #   key            = "aws-migration/terraform.tfstate"
  #   region         = "ap-south-1"
  #   dynamodb_table = "practers-tflock"
  #   encrypt        = true
  # }
}
