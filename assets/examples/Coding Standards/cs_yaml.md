# Azure DevOps Pipeline YAML Coding Standards

## 1. General Formatting
- Use **2 spaces** for indentation (avoid tabs).
- Ensure **proper line breaks** for readability.
- Maintain **consistent casing** (prefer lowercase for key names).
- Avoid **trailing spaces**.

trigger:
  branches:
    include:
      - main
      - release/*

## 2. Naming Conventions
- Use **lowercase with hyphens** for pipeline filenames:  
  - `azure-pipelines.yml`
- Use **PascalCase for variables and parameters**:

MyVariable: value

## 3. Variables and Parameters
- Use **parameters** for values that change per pipeline run.
- Use **variables** for values that remain constant.
- Secure **sensitive values** using Azure DevOps secrets.

parameters:
  - name: environment
    type: string
    default: dev
    values:
      - dev
      - test
      - prod

variables:
  - name: projectName
    value: my-app

## 4. Jobs & Steps Structure
- Keep steps **short and modular**.
- Use **templates for reusable logic**.
- Use **explicit `displayName`** for better readability.

jobs:
  - job: Build
    displayName: "Build Application"
    pool:
      vmImage: ubuntu-latest
    steps:
      - script: echo "Building the application"
        displayName: "Build Step"

## 5. Use Templates for Reusability
Instead of repeating logic in multiple pipelines, use **templates**.

**Template (`build-template.yml`):**

parameters:
  - name: project
    type: string

jobs:
  - job: Build
    steps:
      - script: echo "Building ${{ parameters.project }}"

**Usage in `azure-pipelines.yml`:**

stages:
  - stage: Build
    jobs:
      - template: build-template.yml
        parameters:
          project: my-app

## 6. Trigger and Path Filters
- Use **explicit branch triggers** to avoid unintended runs.
- Filter paths to **optimize pipeline execution**.

trigger:
  branches:
    include:
      - main
      - develop
  paths:
    exclude:
      - docs/*

## 7. Use Conditions Instead of Duplicating Logic
Instead of duplicating jobs for different environments, use `condition`.

jobs:
  - job: Deploy
    condition: eq(variables['Build.SourceBranch'], 'refs/heads/main')
    steps:
      - script: echo "Deploying to Production"

## 8. Secure Sensitive Data
- **Do NOT hardcode secrets** in YAML.
- Use **Azure DevOps Library or Key Vault** for storing sensitive values.

variables:
  - group: my-secret-group
  - name: dbPassword
    value: $(DB_PASSWORD) # Stored in Azure DevOps Secrets

## 9. Use Explicit Pool Names
- Use `vmImage: ubuntu-latest` for Microsoft-hosted agents.
- Use `name:` for self-hosted agents.

pool:
  name: "SelfHostedAgentPool"

## 10. Keep Pipelines DRY (Don't Repeat Yourself)
- Use **templates** to avoid duplication.
- Centralize **reusable variables** in variable groups.
- Avoid **duplicate scripts across multiple jobs**.

---

By following these best practices, your Azure DevOps YAML pipelines will be **clean, maintainable, and scalable**. 🚀
