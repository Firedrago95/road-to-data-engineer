from datetime import datetime
from airflow import DAG
from airflow.operators.bash import BashOperator

with DAG(
    dag_id="check_worker_hostname",
    schedule="* * * * *",
    start_date=datetime(2026, 11, 1),
    catchup=False,
) as dag:
    print_worker = BashOperator(
        task_id="print_hostname",
        bash_command='echo "실행된 워커 호스트명: $(hostname)"'
    )