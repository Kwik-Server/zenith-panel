<div class="panel panel-default">
  <div class="panel-heading">
    <h3 class="panel-title">VPS Status: <span class="label label-{if $status == 'Running'}success{elseif $status == 'Stopped'}default{else}warning{/if}">{$status}</span></h3>
  </div>
  <div class="panel-body">
    <p>Manage your VPS, access the web console, firewall, rDNS and more from the Kwik Server client portal.</p>
    <a href="{$login_url}" target="_blank" class="btn btn-primary">
      <i class="fa fa-sign-in"></i> Manage VPS
    </a>
  </div>
</div>
