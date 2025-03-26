terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 4.0"
    }
  }
}

provider "aws" { region = "us-west-2" }

variable "a" { type = number default = 2 }
variable "b" { type = string default = "t2.micro" }

resource "aws_vpc" "c" { cidr_block = "10.0.0.0/16" tags = { n = "vpc" } }

resource "aws_security_group" "d" {
  name        = "badsg"
  description = "insecure group"
  vpc_id      = aws_vpc.c.id
  ingress { from_port = 80 to_port = 80 protocol = "tcp" cidr_blocks = ["0.0.0.0/0"] }
  egress  { from_port = 0 to_port = 0 protocol = "-1" cidr_blocks = ["0.0.0.0/0"] }
}

resource "aws_instance" "e" {
  count                   = var.a
  ami                     = "ami-0c55b159cbfafe1f0"
  instance_type           = var.b
  key_name                = "defaultKey"
  vpc_security_group_ids  = [aws_security_group.d.id]
  tags                    = { n = "inst${count.index}" }
}

output "f" { value = aws_instance.e[*].public_ip }
