# get-gke-credentials

This action configures authentication to a [GKE cluster][gke] via a `kubeconfig` file that can be used with `kubectl` or other methods of interacting with the cluster.

Authentication is performed by generating a [short-lived token][token] (default behaviour) or via the [GCP auth plugin][gcp-auth-plugin] present in `kubectl` which uses the service account keyfile path in [GOOGLE_APPLICATION_CREDENTIALS][gcp-gcloud-auth].

**This is not an officially supported Google product, and it is not covered by a
Google Cloud support contract. To report bugs or request features in a Google
Cloud product, please contact [Google Cloud
support](https://cloud.google.com/support).**

## Prerequisites

This action requires:

-   Google Cloud credentials that are authorized to view a GKE cluster. See the
    Authorization section below for more information. You also need to
    [create a GKE cluster](https://cloud.google.com/kubernetes-engine/docs/quickstart).

-   This action runs using Node 20. If you are using self-hosted GitHub Actions
    runners, you must use a [runner
    version](https://github.com/actions/virtual-environments) that supports this
    version or newer.

-   If you plan to create binaries, containers, pull requests, or other
    releases, add the following to your .gitignore to prevent accidentially
    committing the KUBECONFIG to your release artifact:

    ```text
    # Ignore generated kubeconfig from google-github-actions/get-gke-credentials
    gha-kubeconfig-*
    ```

## Usage

```yaml
jobs:
  job_id:
    permissions:
      contents: 'read'
      id-token: 'write'

    steps:
    - id: 'auth'
      uses: 'google-github-actions/auth@v2'
      with:
        project_id: 'my-project'
        workload_identity_provider: 'projects/123456789/locations/global/workloadIdentityPools/my-pool/providers/my-provider'

    - id: 'get-credentials'
      uses: 'google-github-actions/get-gke-credentials@v2'
      with:
        cluster_name: 'my-cluster'
        location: 'us-central1-a'

    # The KUBECONFIG env var is automatically exported and picked up by kubectl.
    - id: 'get-pods'
      run: 'kubectl get pods'
```

## Inputs

<!-- BEGIN_AUTOGEN_INPUTS -->

-   <a name="__input_cluster_name"></a><a href="#user-content-__input_cluster_name"><code>cluster_name</code></a>: _(Required)_ Name of the cluster for which to get credentials. This can be specified as
    a full resource name:

        projects/<project>/locations/<location>/clusters/<cluster>

    In which case the `project_id` and `location` inputs are optional. If only
    specified as a name:

        <cluster>

    then both the `project_id` and `location` may be required.

-   <a name="__input_location"></a><a href="#user-content-__input_location"><code>location</code></a>: _(Optional)_ Location (region or zone) in which the cluster resides. This value is
    required unless `cluster_name` is a full resource name.

-   <a name="__input_project_id"></a><a href="#user-content-__input_project_id"><code>project_id</code></a>: _(Optional)_ Project ID where the cluster is deployed. If provided, this will override
    the project configured by previous steps or environment variables. If not
    provided, the project will be inferred from the environment, best-effort.

-   <a name="__input_context_name"></a><a href="#user-content-__input_context_name"><code>context_name</code></a>: _(Optional)_ Name to use when creating the `kubectl` context. If not specified, the
    default value is `gke_<project>_<location>_<cluster>`.

-   <a name="__input_namespace"></a><a href="#user-content-__input_namespace"><code>namespace</code></a>: _(Optional)_ Name of the Kubernetes namespace to use within the context.

-   <a name="__input_use_auth_provider"></a><a href="#user-content-__input_use_auth_provider"><code>use_auth_provider</code></a>: _(Optional, default: `false`)_ Set this to true to use the Google Cloud auth plugin in `kubectl` instead
    of inserting a short-lived access token.

-   <a name="__input_use_internal_ip"></a><a href="#user-content-__input_use_internal_ip"><code>use_internal_ip</code></a>: _(Optional, default: `false`)_ Set this to true to use the internal IP address for the cluster endpoint.
    This is mostly used with private GKE clusters.

-   <a name="__input_use_connect_gateway"></a><a href="#user-content-__input_use_connect_gateway"><code>use_connect_gateway</code></a>: _(Optional, default: `false`)_ Set this to true to use the [Connect Gateway
    endpoint](https://cloud.google.com/anthos/multicluster-management/gateway)
    to connect to cluster.

-   <a name="__input_use_dns_based_endpoint"></a><a href="#user-content-__input_use_dns_based_endpoint"><code>use_dns_based_endpoint</code></a>: _(Optional, default: `false`)_ Set this true to use [DNS-based endpoint](https://cloud.google.com/kubernetes-engine/docs/concepts/network-isolation#dns-based_endpoint)
    to connect to the cluster.

-   <a name="__input_fleet_membership_name"></a><a href="#user-content-__input_fleet_membership_name"><code>fleet_membership_name</code></a>: _(Optional)_ Fleet membership name to use for generating Connect Gateway endpoint, of
    the form:

        projects/<project>/locations/<location>/memberships/<membership>

    This only applies if `use_connect_gateway` is true. Defaults to auto
    discovery if empty.

-   <a name="__input_quota_project_id"></a><a href="#user-content-__input_quota_project_id"><code>quota_project_id</code></a>: _(Optional)_ Project ID from which to pull quota. The caller must have
    `serviceusage.services.use` permission on the project. If unspecified,
    this defaults to the project of the authenticated principle. This is an
    advanced setting, most users should leave this blank.


<!-- END_AUTOGEN_INPUTS -->

## Outputs

In addition to setting the `$KUBECONFIG` environment variable, this GitHub
Action produces the following outputs:

<!-- BEGIN_AUTOGEN_OUTPUTS -->

-   <a name="__output_kubeconfig_path"></a><a href="#user-content-__output_kubeconfig_path"><code>kubeconfig_path</code></a>: Path on the local filesystem where the generated Kubernetes configuration
    file resides.


<!-- END_AUTOGEN_OUTPUTS -->


## Authorization

There are a few ways to authenticate this action. A service account will be needed
with **at least** the following roles:

- Kubernetes Engine Cluster Viewer (`roles/container.clusterViewer`)

If you are using the Connect Gateway, you must also have:

-   GKE Hub Viewer (`roles/gkehub.viewer`)


### Via google-github-actions/auth

Use [google-github-actions/auth](https://github.com/google-github-actions/auth) to authenticate the action. You can use [Workload Identity Federation][wif] or traditional [Service Account Key JSON][sa] authentication.
by specifying the `credentials` input. This Action supports both the recommended [Workload Identity Federation][wif] based authentication and the traditional [Service Account Key JSON][sa] based auth.

See [usage](https://github.com/google-github-actions/auth#usage) for more details.

#### Authenticating via Workload Identity Federation

```yaml
jobs:
  job_id:
    permissions:
      contents: 'read'
      id-token: 'write'

    steps:
    - id: 'auth'
      uses: 'google-github-actions/auth@v2'
      with:
        project_id: 'my-project'
        workload_identity_provider: 'projects/123456789/locations/global/workloadIdentityPools/my-pool/providers/my-provider'

    - id: 'get-credentials'
      uses: 'google-github-actions/get-gke-credentials@v2'
      with:
        cluster_name: 'my-cluster'
        location: 'us-central1-a'
```

#### Authenticating via Service Account Key JSON

```yaml
jobs:
  job_id:
    steps:
    - id: 'auth'
      uses: 'google-github-actions/auth@v2'
      with:
        credentials_json: '${{ secrets.gcp_credentials }}'

    - id: 'get-credentials'
      uses: 'google-github-actions/get-gke-credentials@v2'
      with:
        cluster_name: 'my-cluster'
        location: 'us-central1-a'
```

### Via Application Default Credentials

If you are hosting your own runners, **and** those runners are on Google Cloud,
you can leverage the Application Default Credentials of the instance. This will
authenticate requests as the service account attached to the instance. **This
only works using a custom runner hosted on GCP.**

```yaml
jobs:
  job_id:
    steps:
    - id: 'get-credentials'
      uses: 'google-github-actions/get-gke-credentials@v2'
      with:
        cluster_name: 'my-cluster'
        location: 'us-central1-a'
```

The action will automatically detect and use the Application Default
Credentials.

## With Connect gateway

You can utilize the [Connect gateway][connect-gw] feature of [Fleets][fleets] with this action
to connect to clusters without direct network connectivity. This can be useful for connecting to [private clusters](https://cloud.google.com/kubernetes-engine/docs/concepts/private-cluster-concept)
from GitHub hosted runners.

```yaml
jobs:
  job_id:
    steps:
    - id: 'get-credentials'
      uses: 'google-github-actions/get-gke-credentials@v2'
      with:
        cluster_name: 'my-private-cluster'
        location: 'us-central1-a'
        use_connect_gateway: 'true'
```

Follow the [Connect gateway documentation][connect-gw] for initial setup.
Note: The Connect Agent service account must have the correct [impersonation policy][connect-gw-impersonation] on the service account used to authenticate this action.


[gke]: https://cloud.google.com/kubernetes-engine
[gcp-auth-plugin]: https://github.com/kubernetes/client-go/tree/master/plugin/pkg/client/auth/gcp
[gcp-gcloud-auth]: https://cloud.google.com/kubernetes-engine/docs/how-to/api-server-authentication#using-gcloud-config
[token]: https://kubernetes.io/docs/reference/access-authn-authz/authentication/#openid-connect-tokens
[sm]: https://cloud.google.com/secret-manager
[sa]: https://cloud.google.com/iam/docs/creating-managing-service-accounts
[wif]: https://cloud.google.com/iam/docs/workload-identity-federation
[gh-runners]: https://help.github.com/en/actions/hosting-your-own-runners/about-self-hosted-runners
[gh-secret]: https://help.github.com/en/actions/configuring-and-managing-workflows/creating-and-storing-encrypted-secrets
[setup-gcloud]: ../setup-gcloud
[connect-gw]: https://cloud.google.com/anthos/multicluster-management/gateway/setup
[connect-gw-impersonation]: https://cloud.google.com/anthos/multicluster-management/gateway/setup#gcloud
[fleets]: https://cloud.google.com/anthos/multicluster-management/fleet-overview#authenticating_to_clusters
