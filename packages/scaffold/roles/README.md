# Bluecadet Scaffold Collection

This repository contains the `bluecadet.scaffold` Ansible Collection.

## External requirements

Some modules and plugins require external libraries. Please check the requirements for each plugin or module you use in the documentation to find out which requirements are needed.

## Included content

<!--start collection content-->
<!--end collection content-->

## Using this collection

```bash
    ansible-galaxy collection install bluecadet.scaffold
```

You can also include it in a `requirements.yml` file and install it via `ansible-galaxy collection install -r requirements.yml` using the format:

```yaml
collections:
  - name: bluecadet.scaffold
```

To upgrade the collection to the latest available version, run the following command:

```bash
ansible-galaxy collection install bluecadet.scaffold --upgrade
```

You can also install a specific version of the collection, for example, if you need to downgrade when something is broken in the latest version (please report an issue in this repository). Use the following syntax where `X.Y.Z` can be any [available version](https://galaxy.ansible.com/bluecadet/scaffold):

```bash
ansible-galaxy collection install bluecadet.scaffold:==X.Y.Z
```

See [Ansible Using collections](https://docs.ansible.com/ansible/latest/user_guide/collections_using.html) for more details.

## Release notes

See the [changelog](https://github.com/ansible-collections/bluecadet.scaffold/tree/main/CHANGELOG.md).
