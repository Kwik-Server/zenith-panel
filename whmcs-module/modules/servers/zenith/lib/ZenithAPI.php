<?php
class ZenithAPI {
    private string $baseUrl;
    private string $apiKey;

    public function __construct(string $host, string $apiKey, bool $secure = true) {
        $scheme = $secure ? 'https' : 'http';
        $this->baseUrl = "{$scheme}://{$host}/api/v1";
        $this->apiKey  = $apiKey;
    }

    public function provision(array $data): array {
        return $this->request('POST', '/whmcs/provision', $data);
    }

    public function suspend(string $uuid): array {
        return $this->request('POST', "/whmcs/{$uuid}/suspend");
    }

    public function unsuspend(string $uuid): array {
        return $this->request('POST', "/whmcs/{$uuid}/unsuspend");
    }

    public function terminate(string $uuid): array {
        return $this->request('DELETE', "/whmcs/{$uuid}");
    }

    public function getStatus(string $uuid): array {
        return $this->request('GET', "/whmcs/{$uuid}/status");
    }

    public function testConnection(): bool {
        try {
            $result = $this->request('GET', '/ping');
            return isset($result['status']) && $result['status'] === 'ok';
        } catch (Exception $e) { return false; }
    }

    private function request(string $method, string $endpoint, array $data = []): array {
        $url = $this->baseUrl . $endpoint;
        $ch  = curl_init();
        curl_setopt_array($ch, [
            CURLOPT_URL            => $url,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => 30,
            CURLOPT_SSL_VERIFYPEER => false,
            CURLOPT_HTTPHEADER     => [
                'X-WHMCS-Key: ' . $this->apiKey,
                'Content-Type: application/json',
                'Accept: application/json',
            ],
            CURLOPT_CUSTOMREQUEST  => strtoupper($method),
        ]);
        if (!empty($data) && in_array(strtoupper($method), ['POST', 'PUT', 'DELETE'])) {
            curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($data));
        }
        $body   = curl_exec($ch);
        $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $err    = curl_error($ch);
        curl_close($ch);

        if ($err) throw new Exception("cURL error: {$err}");

        $json = json_decode($body, true);
        if (json_last_error() !== JSON_ERROR_NONE) throw new Exception("Invalid JSON response");
        if (!($json['success'] ?? false)) throw new Exception($json['error'] ?? 'Unknown API error');

        return $json['data'] ?? $json;
    }
}
