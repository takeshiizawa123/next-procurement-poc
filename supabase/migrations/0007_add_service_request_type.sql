-- スポット役務（単発コンサル、修繕等）を購買申請で扱えるようrequest_typeに"役務"を追加
ALTER TYPE request_type ADD VALUE IF NOT EXISTS '役務';
